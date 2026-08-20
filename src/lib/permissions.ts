/**
 * The single permission model for KAIROS.
 *
 * ## Why this file was rewritten
 *
 * There used to be three competing permission systems:
 *
 *  1. A role matrix here, understanding only `admin | worker | mentor`, whose
 *     `default` branch returned **write** permissions — so `member`, `guest` and
 *     any unrecognised value failed *open*. It was also imported by exactly one
 *     `"use client"` hook and never consulted by the server, which made the
 *     view-only `mentor` role a browser-side decoration.
 *  2. Eight boolean columns on `organization_members` (`canAddMembers`,
 *     `canDeleteTasks`, …), written at membership creation and then almost never
 *     read.
 *  3. An `organization_roles` table carrying the same eight booleans as
 *     reusable templates.
 *
 * Different call sites consulted different ones. This module now defines one
 * model, and the eight boolean columns are its source of truth:
 *
 *   role  ──derive──▶  8 flags on organization_members  ──authorize──▶  mutation
 *
 * A role is only ever a *template* applied when a membership row is created or
 * its role changed. Every server-side decision reads the columns, so an admin
 * can grant or revoke an individual flag without fighting the role.
 *
 * ## Fail closed
 *
 * `flagsForRole` returns all-false for `null`, `undefined` and any string
 * outside `org_role`. Adding a value to the enum without adding it here
 * therefore removes access rather than granting it.
 */

/** Every value of the `org_role` Postgres enum. */
export const ORG_ROLES = [
  "admin",
  "member",
  "guest",
  "worker",
  "mentor",
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * The eight boolean columns on `organization_members`, which are also the eight
 * on `organization_roles`. Keys match the Drizzle field names exactly so a
 * template can be spread straight into an insert or update.
 */
export interface MemberPermissionFlags {
  canAddMembers: boolean;
  canAssignTasks: boolean;
  canCreateProjects: boolean;
  canDeleteTasks: boolean;
  canKickMembers: boolean;
  canManageRoles: boolean;
  canEditProjects: boolean;
  canViewAnalytics: boolean;
}

export const PERMISSION_FLAG_KEYS = [
  "canAddMembers",
  "canAssignTasks",
  "canCreateProjects",
  "canDeleteTasks",
  "canKickMembers",
  "canManageRoles",
  "canEditProjects",
  "canViewAnalytics",
] as const satisfies readonly (keyof MemberPermissionFlags)[];

export type PermissionFlag = (typeof PERMISSION_FLAG_KEYS)[number];

const NO_PERMISSIONS: MemberPermissionFlags = {
  canAddMembers: false,
  canAssignTasks: false,
  canCreateProjects: false,
  canDeleteTasks: false,
  canKickMembers: false,
  canManageRoles: false,
  canEditProjects: false,
  canViewAnalytics: false,
};

const ALL_PERMISSIONS: MemberPermissionFlags = {
  canAddMembers: true,
  canAssignTasks: true,
  canCreateProjects: true,
  canDeleteTasks: true,
  canKickMembers: true,
  canManageRoles: true,
  canEditProjects: true,
  canViewAnalytics: true,
};

/**
 * A contributing member: can plan and edit work, but not administer the
 * organization and not delete other people's tasks. `canDeleteTasks` stays false
 * deliberately — it is the flag an admin grants individually.
 */
const CONTRIBUTOR_PERMISSIONS: MemberPermissionFlags = {
  ...NO_PERMISSIONS,
  canAssignTasks: true,
  canCreateProjects: true,
  canEditProjects: true,
  canViewAnalytics: true,
};

/**
 * Role templates.
 *
 * `worker` and `member` are the same role from two different naming eras — the
 * access-code join flow writes `worker`, the invite and role-management flows
 * write `member`. They intentionally resolve to identical flags rather than
 * being collapsed in the enum, which would need a data migration.
 *
 * `guest` and `mentor` are both read-only. `mentor` is the one the UI surfaces
 * (see `ViewOnlyBanner`); with these flags it is finally read-only on the server
 * too, not just in the browser.
 */
const ROLE_TEMPLATES: Record<OrgRole, MemberPermissionFlags> = {
  admin: ALL_PERMISSIONS,
  member: CONTRIBUTOR_PERMISSIONS,
  worker: CONTRIBUTOR_PERMISSIONS,
  guest: NO_PERMISSIONS,
  mentor: NO_PERMISSIONS,
};

export function isOrgRole(role: unknown): role is OrgRole {
  return typeof role === "string" && (ORG_ROLES as readonly string[]).includes(role);
}

/**
 * The flag template for a role, for use when creating a membership row or
 * changing someone's role.
 *
 * Unknown, null and undefined roles return no permissions. This is the
 * fail-closed direction: a role that this code does not recognise cannot be
 * trusted to imply write access.
 */
export function flagsForRole(role: unknown): MemberPermissionFlags {
  if (!isOrgRole(role)) return { ...NO_PERMISSIONS };
  return { ...ROLE_TEMPLATES[role] };
}

/**
 * True when a role grants no write capability at all — used by the UI to show
 * the view-only banner and to disable controls. Server code should test the
 * specific flag it needs instead, via `~/server/api/authz`.
 */
export function isViewOnlyRole(role: unknown): boolean {
  const flags = flagsForRole(role);
  return PERMISSION_FLAG_KEYS.every((key) => !flags[key]);
}

// ---------------------------------------------------------------------------
// Client-facing view
// ---------------------------------------------------------------------------

/**
 * The shape the UI consumes. It is intentionally *derived* from the flags rather
 * than being its own matrix, so the browser can never disagree with the server
 * about who may do what.
 *
 * Notes and events are not organization-scoped in the schema — they are owned by
 * their creator — so a read-only role is prevented from creating them, but
 * anyone with any write flag may manage their own.
 */
export interface RolePermissions extends MemberPermissionFlags {
  canDeleteProjects: boolean;
  canCreateTasks: boolean;
  canEditTasks: boolean;
  canCreateNotes: boolean;
  canEditNotes: boolean;
  canDeleteNotes: boolean;
  canCreateEvents: boolean;
  canEditEvents: boolean;
  canDeleteEvents: boolean;
  canManageMembers: boolean;
  canManageOrg: boolean;
  isViewOnly: boolean;
}

export function permissionsFromFlags(
  flags: MemberPermissionFlags,
): RolePermissions {
  const isViewOnly = PERMISSION_FLAG_KEYS.every((key) => !flags[key]);
  const canWriteOwnContent = !isViewOnly;

  return {
    ...flags,
    // No `canDeleteProjects` column exists. Deletion tracks `canDeleteTasks` —
    // the one destructive capability that *is* a column — rather than
    // `canEditProjects`, so that a contributor who may edit a project still
    // cannot destroy it. That was the intent of the original role matrix and it
    // is what the server enforces in `project.delete`.
    canDeleteProjects: flags.canDeleteTasks,
    canCreateTasks: flags.canAssignTasks,
    canEditTasks: flags.canEditProjects,
    canCreateNotes: canWriteOwnContent,
    canEditNotes: canWriteOwnContent,
    canDeleteNotes: canWriteOwnContent,
    canCreateEvents: canWriteOwnContent,
    canEditEvents: canWriteOwnContent,
    canDeleteEvents: canWriteOwnContent,
    canManageMembers: flags.canAddMembers || flags.canKickMembers,
    canManageOrg: flags.canManageRoles,
    isViewOnly,
  };
}

/**
 * Permissions for a role, as the UI sees them.
 *
 * Prefer `permissionsFromFlags` with the membership row actually loaded from the
 * database: an admin may have adjusted an individual flag away from the
 * template, and only the row knows that. This overload exists for callers that
 * genuinely have nothing but a role string.
 */
export function getPermissions(role: unknown): RolePermissions {
  return permissionsFromFlags(flagsForRole(role));
}

/** Permissions for someone working outside any organization, on their own data. */
export function personalModePermissions(): RolePermissions {
  return permissionsFromFlags(ALL_PERMISSIONS);
}
