/**
 * Shared project authorization.
 *
 * Before this module existed, the "can this user touch this project?" check was
 * re-implemented inline at every call site (four times in `routers/task.ts`
 * alone, again as a private helper in `routers/chat.ts`, and again in raw SQL in
 * `ws-server/rooms.ts`). The copies drifted, and the LLM agent layer — which
 * reaches `ctx.db` directly rather than through a router — never got one at all.
 *
 * Everything that resolves a project from caller-supplied input should go
 * through `assertProjectAccess`.
 *
 * Access model (deliberately matching the loosest pre-existing router check, so
 * that consolidating here does not silently change product behaviour):
 *
 *   read   — project owner, any member of the project's organization, or any
 *            project collaborator (read or write).
 *   write  — project owner, any member of the project's organization, or a
 *            collaborator whose permission is "write".
 *
 * `assertProjectAccess` answers "may this caller see or touch the project at
 * all". It is deliberately coarse. Individual mutations additionally require a
 * specific capability, which is what `assertProjectPermission` is for:
 *
 *   assertProjectAccess(ctx, id, "write")            → is this your project?
 *   assertProjectPermission(ctx, id, "canDeleteTasks") → …and may you delete in it?
 *
 * The capability comes from the eight boolean columns on `organization_members`,
 * which `~/lib/permissions` establishes as the single source of truth. Before
 * this, those columns were written at membership creation and then never read,
 * and the `mentor` view-only role was enforced only in the browser — any org
 * member could create, edit and delete anything by calling tRPC directly.
 *
 * Personal projects (`organizationId === null`) have no membership row and
 * therefore no flags. There, ownership and the collaborator permission remain
 * the authority; capability checks apply only to organization-scoped projects.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import {
  flagsForRole,
  type MemberPermissionFlags,
  type PermissionFlag,
} from "~/lib/permissions";
import type { TRPCContext } from "~/server/api/trpc";
import {
  organizationMembers,
  projectCollaborators,
  projects,
  type Project,
} from "~/server/db/schema";

export type ProjectAction = "read" | "write";

/**
 * The membership columns authorization depends on. Selected explicitly so that
 * adding a column to the table does not silently widen what these queries pull.
 */
const MEMBERSHIP_COLUMNS = {
  role: organizationMembers.role,
  canAddMembers: organizationMembers.canAddMembers,
  canAssignTasks: organizationMembers.canAssignTasks,
  canCreateProjects: organizationMembers.canCreateProjects,
  canDeleteTasks: organizationMembers.canDeleteTasks,
  canKickMembers: organizationMembers.canKickMembers,
  canManageRoles: organizationMembers.canManageRoles,
  canEditProjects: organizationMembers.canEditProjects,
  canViewAnalytics: organizationMembers.canViewAnalytics,
} as const;

export interface Membership extends MemberPermissionFlags {
  role: string;
}

export interface ProjectAccess {
  project: Project;
  isOwner: boolean;
  isOrgMember: boolean;
  /**
   * The caller's membership row in the project's organization, or `null` for a
   * personal project or a non-member.
   */
  membership: Membership | null;
  /** `null` when the caller is not a collaborator on this project. */
  collaboratorPermission: "read" | "write" | null;
}

function requireUserId(ctx: TRPCContext): string {
  const userId = ctx.session?.user?.id;
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return userId;
}

/**
 * Resolve how the current caller relates to a project, without deciding whether
 * that is sufficient. Use `assertProjectAccess` unless you need the detail.
 *
 * Throws NOT_FOUND when the project does not exist, so that callers cannot
 * distinguish "no such project" from "exists but forbidden" by timing alone
 * beyond what the subsequent access decision already reveals.
 */
export async function getProjectAccess(
  ctx: TRPCContext,
  projectId: number,
): Promise<ProjectAccess> {
  const userId = requireUserId(ctx);

  const [project] = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const isOwner = project.createdById === userId;

  let membership: Membership | null = null;
  if (project.organizationId !== null) {
    const [row] = await ctx.db
      .select(MEMBERSHIP_COLUMNS)
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, project.organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);
    membership = row ?? null;
  }

  const [collaboration] = await ctx.db
    .select({ permission: projectCollaborators.permission })
    .from(projectCollaborators)
    .where(
      and(
        eq(projectCollaborators.projectId, projectId),
        eq(projectCollaborators.collaboratorId, userId),
      ),
    )
    .limit(1);

  return {
    project,
    isOwner,
    isOrgMember: membership !== null,
    membership,
    collaboratorPermission: collaboration?.permission ?? null,
  };
}

/**
 * Assert that the caller may perform `action` on `projectId`, and return the
 * project so callers don't need a second query.
 *
 * @throws TRPCError NOT_FOUND when the project does not exist.
 * @throws TRPCError FORBIDDEN when the caller lacks the required access.
 */
export async function assertProjectAccess(
  ctx: TRPCContext,
  projectId: number,
  action: ProjectAction = "read",
): Promise<Project> {
  const access = await getProjectAccess(ctx, projectId);

  const allowed =
    access.isOwner ||
    access.isOrgMember ||
    (action === "read"
      ? access.collaboratorPermission !== null
      : access.collaboratorPermission === "write");

  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        action === "write"
          ? "You don't have write access to this project"
          : "You don't have access to this project",
    });
  }

  return access.project;
}

// ---------------------------------------------------------------------------
// Capability checks
// ---------------------------------------------------------------------------

/**
 * Human-readable names for the flags, used in error messages. Members see *which*
 * capability they lack, which is actionable ("ask an admin for it") in a way that
 * a bare "forbidden" is not.
 */
const FLAG_LABELS: Record<PermissionFlag, string> = {
  canAddMembers: "invite members",
  canAssignTasks: "create and assign tasks",
  canCreateProjects: "create projects",
  canDeleteTasks: "delete tasks",
  canKickMembers: "remove members",
  canManageRoles: "manage roles and permissions",
  canEditProjects: "edit projects",
  canViewAnalytics: "view analytics",
};

/**
 * Read a capability off a membership row, falling back to the role template when
 * the row predates the flag backfill.
 *
 * The fallback exists because `join` used to insert memberships with every flag
 * `false` regardless of role, so rows written before the backfill migration
 * cannot be distinguished from a deliberate revocation by looking at the columns
 * alone. Deriving from the role in that case keeps existing contributors working.
 * Once every row is backfilled this reduces to a plain column read.
 */
export function membershipHasFlag(
  membership: Membership | null,
  flag: PermissionFlag,
): boolean {
  if (!membership) return false;
  if (membership[flag]) return true;

  const everyFlagFalse = (
    Object.keys(FLAG_LABELS) as PermissionFlag[]
  ).every((key) => !membership[key]);

  return everyFlagFalse ? flagsForRole(membership.role)[flag] : false;
}

function denyMissingFlag(flag: PermissionFlag): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `You don't have permission to ${FLAG_LABELS[flag]} in this organization`,
  });
}

/**
 * Assert that the caller may perform a specific capability on `projectId`.
 *
 * Layered on top of `assertProjectAccess`, so it also covers project existence
 * and basic access. The capability is only required for organization-scoped
 * projects: a personal project has no membership row, and its owner (or a
 * write-collaborator) is the authority there.
 *
 * @throws TRPCError NOT_FOUND when the project does not exist.
 * @throws TRPCError FORBIDDEN when the caller lacks access or the capability.
 */
export async function assertProjectPermission(
  ctx: TRPCContext,
  projectId: number,
  flag: PermissionFlag,
): Promise<Project> {
  const access = await getProjectAccess(ctx, projectId);

  const hasBaseAccess =
    access.isOwner ||
    access.isOrgMember ||
    access.collaboratorPermission === "write";

  if (!hasBaseAccess) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have write access to this project",
    });
  }

  // Personal project: no organization, so no flags to consult.
  if (access.project.organizationId === null) return access.project;

  // An outside collaborator granted write access is not governed by the
  // organization's role flags — the grant itself is the authorization.
  if (!access.isOrgMember && access.collaboratorPermission === "write") {
    return access.project;
  }

  if (!membershipHasFlag(access.membership, flag)) {
    denyMissingFlag(flag);
  }

  return access.project;
}

/**
 * Load the caller's membership in an organization, or throw.
 *
 * For organization-level mutations that have no project to hang off — inviting
 * members, changing roles, editing workspace settings.
 */
export async function requireMembership(
  ctx: TRPCContext,
  organizationId: number,
): Promise<Membership> {
  const userId = requireUserId(ctx);

  const [membership] = await ctx.db
    .select(MEMBERSHIP_COLUMNS)
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization",
    });
  }

  return membership;
}

/**
 * Assert an organization-level capability and return the membership row.
 *
 * @throws TRPCError FORBIDDEN when the caller is not a member or lacks the flag.
 */
export async function assertOrgPermission(
  ctx: TRPCContext,
  organizationId: number,
  flag: PermissionFlag,
): Promise<Membership> {
  const membership = await requireMembership(ctx, organizationId);
  if (!membershipHasFlag(membership, flag)) denyMissingFlag(flag);
  return membership;
}
