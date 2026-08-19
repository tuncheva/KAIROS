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
 * Note that org membership currently grants write access. Narrowing that to the
 * per-member permission columns (`canDeleteTasks`, `canEditProjects`, …) and to
 * the view-only `mentor` role is a separate change: those columns are written on
 * membership creation but never read, and the role matrix in
 * `src/lib/permissions.ts` is enforced only in the browser.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import {
  organizationMembers,
  projectCollaborators,
  projects,
  type Project,
} from "~/server/db/schema";

export type ProjectAction = "read" | "write";

export interface ProjectAccess {
  project: Project;
  isOwner: boolean;
  isOrgMember: boolean;
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

  let isOrgMember = false;
  if (project.organizationId !== null) {
    const [membership] = await ctx.db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, project.organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);
    isOrgMember = !!membership;
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
    isOrgMember,
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
