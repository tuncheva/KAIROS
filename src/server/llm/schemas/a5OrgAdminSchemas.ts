import { z } from "zod";

import { ORG_ROLES, PERMISSION_FLAG_KEYS } from "~/lib/permissions";

/**
 * A5 — Org Admin plan shapes.
 *
 * The narrowest plan schema of any KAIROS agent, on purpose. A2 can create
 * thirty tasks in one plan because a wrong task is deleted in a click; a wrong
 * role change hands somebody the ability to make more role changes, and a wrong
 * removal drops a person's access to every project in the organization.
 *
 * So the limits are deliberately small, and — unlike A2, where only deletes are
 * dangerous — every operation here is dangerous by construction. There is no
 * "safe" org write.
 */

export const OrgRoleSchema = z.enum(ORG_ROLES);
export const PermissionFlagSchema = z.enum(PERMISSION_FLAG_KEYS);

const RationaleSchema = z
  .string()
  .min(1)
  .max(300)
  .describe("Why this change, in the user's own terms. Shown on the confirm card.");

export const RoleChangeSchema = z
  .object({
    organizationId: z.number().int().positive(),
    targetUserId: z.string().min(1),
    /** Shown on the confirm card — an id is not something a person can check. */
    targetName: z.string().min(1).max(120),
    currentRole: OrgRoleSchema.optional(),
    newRole: OrgRoleSchema,
    rationale: RationaleSchema,
  })
  .strip();

export const PermissionChangeSchema = z
  .object({
    organizationId: z.number().int().positive(),
    targetUserId: z.string().min(1),
    targetName: z.string().min(1).max(120),
    /** Only the flags being changed; anything absent is left alone. */
    grant: z.array(PermissionFlagSchema).max(8).default([]),
    revoke: z.array(PermissionFlagSchema).max(8).default([]),
    rationale: RationaleSchema,
  })
  .strip();

export const MemberRemovalSchema = z
  .object({
    organizationId: z.number().int().positive(),
    targetUserId: z.string().min(1),
    targetName: z.string().min(1).max(120),
    rationale: RationaleSchema,
  })
  .strip();

export const MemberInviteSchema = z
  .object({
    organizationId: z.number().int().positive(),
    email: z.string().email(),
    role: OrgRoleSchema.default("member"),
    rationale: RationaleSchema,
  })
  .strip();

export const OrgAdminDraftSchema = z
  .object({
    /** One or two sentences the user reads before deciding. */
    summary: z.string().min(1).max(600),
    roleChanges: z.array(RoleChangeSchema).max(10).default([]),
    permissionChanges: z.array(PermissionChangeSchema).max(10).default([]),
    removals: z.array(MemberRemovalSchema).max(5).default([]),
    invites: z.array(MemberInviteSchema).max(10).default([]),
    /**
     * What the user should know before confirming — a demotion that removes the
     * last admin, a removal that orphans assigned tasks.
     */
    warnings: z.array(z.string().min(1).max(300)).max(10).default([]),
    /** Anything A5 could not resolve and needs answered before applying. */
    questions: z.array(z.string().min(1).max(300)).max(5).default([]),
    planHash: z.string().optional(),
  })
  .strip();

export type OrgAdminDraft = z.infer<typeof OrgAdminDraftSchema>;
export type RoleChange = z.infer<typeof RoleChangeSchema>;
export type PermissionChange = z.infer<typeof PermissionChangeSchema>;
export type MemberRemoval = z.infer<typeof MemberRemovalSchema>;
export type MemberInvite = z.infer<typeof MemberInviteSchema>;

export interface OrgAdminApplyOutput {
  applied: true;
  results: {
    rolesChanged: number;
    permissionsChanged: number;
    membersRemoved: number;
    invitesSent: number;
    /** Operations the plan asked for that the server refused, and why. */
    refused: string[];
  };
}

// ---------------------------------------------------------------------------
// Router input schemas
// ---------------------------------------------------------------------------

export const OrgAdminDraftInputSchema = z.object({
  message: z.string().min(1).max(20_000),
  organizationId: z.number().int().positive().optional(),
});

export const OrgAdminConfirmInputSchema = z.object({
  draftId: z.string().min(1),
});

export const OrgAdminApplyInputSchema = z.object({
  draftId: z.string().min(1),
  confirmationToken: z.string().min(1),
});
