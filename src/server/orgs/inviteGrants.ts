import { createHash, randomBytes } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  ORG_ROLES,
  PERMISSION_FLAG_KEYS,
  baseRoleForFlags,
  flagsBeyond,
  flagsForRole,
  pickPermissionFlags,
  type MemberPermissionFlags,
  type OrgRole,
} from "~/lib/permissions";

/**
 * What an invite hands out: a role, an optional custom-role label, and the exact
 * eight flags. Every way into a workspace that an admin configures by hand —
 * email invite, share link, typed code — carries one of these.
 */
export const permissionFlagsSchema = z.object(
  Object.fromEntries(PERMISSION_FLAG_KEYS.map((key) => [key, z.boolean()])) as Record<
    (typeof PERMISSION_FLAG_KEYS)[number],
    z.ZodBoolean
  >,
);

export const inviteGrantSchema = z.object({
  /** The template the flags started from. Normalised against the flags below. */
  role: z.enum(ORG_ROLES),
  /** A custom role's name, shown instead of the built-in role label. */
  displayRole: z.string().trim().min(1).max(100).nullish(),
  /** The exact flags. Omitted means "the role's template, unmodified". */
  permissions: permissionFlagsSchema.optional(),
});

export type InviteGrantInput = z.infer<typeof inviteGrantSchema>;

export interface InviteGrant {
  role: OrgRole;
  displayRole: string | null;
  permissions: MemberPermissionFlags;
}

/** The caller's membership row, as far as granting is concerned. */
export type Granter = { role: string } & MemberPermissionFlags;

/**
 * Turn what the admin ticked into what will be stored, or refuse.
 *
 * Two escalation paths are closed here. Inviting someone as `admin` is role
 * management, so it needs an admin holding `canManageRoles`. And a member who
 * may invite only because they were delegated `canAddMembers` cannot hand out a
 * flag they do not hold themselves — otherwise they could invite an address they
 * control with `canManageRoles` and promote themselves by proxy.
 */
export function resolveGrant(granter: Granter, input: InviteGrantInput): InviteGrant {
  const permissions = input.permissions
    ? pickPermissionFlags(input.permissions)
    : flagsForRole(input.role);
  const role = baseRoleForFlags(input.role, permissions);
  const isRoleManager = granter.role === "admin" && granter.canManageRoles;

  if (role === "admin" && !isRoleManager) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only admins with role management permission can invite admins",
    });
  }

  if (!isRoleManager) {
    const beyond = flagsBeyond(permissions, pickPermissionFlags(granter));
    if (beyond.length > 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You can't grant permissions you don't have yourself: ${beyond
          .map((key) => PERMISSION_LABELS_EN[key])
          .join(", ")}`,
      });
    }
  }

  return { role, displayRole: input.displayRole ?? null, permissions };
}

/**
 * The flags a stored invite or link grants.
 *
 * Rows written before permissions were stored have none, and get their role's
 * template — which is exactly what they would have got before.
 */
export function storedGrantFlags(
  stored: unknown,
  fallback: MemberPermissionFlags,
): MemberPermissionFlags {
  return stored ? pickPermissionFlags(stored) : { ...fallback };
}

/** English labels, for email and error messages (the UI uses i18n). */
export const PERMISSION_LABELS_EN: Record<(typeof PERMISSION_FLAG_KEYS)[number], string> = {
  canCreateProjects: "Create projects",
  canEditProjects: "Edit projects",
  canAssignTasks: "Assign tasks",
  canDeleteTasks: "Delete tasks",
  canAddMembers: "Invite members",
  canKickMembers: "Remove members",
  canManageRoles: "Manage roles",
  canViewAnalytics: "View analytics",
};

const ROLE_LABELS_EN: Record<OrgRole, string> = {
  admin: "Admin",
  member: "Member",
  worker: "Member",
  guest: "Guest",
  mentor: "Mentor",
};

export function roleLabelEn(role: OrgRole, displayRole: string | null | undefined): string {
  return displayRole ?? ROLE_LABELS_EN[role];
}

export function grantedLabelsEn(flags: MemberPermissionFlags): string[] {
  return PERMISSION_FLAG_KEYS.filter((key) => flags[key]).map((key) => PERMISSION_LABELS_EN[key]);
}

/** 256 bits, URL-safe. Only its hash is stored. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
