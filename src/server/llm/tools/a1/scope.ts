/**
 * What the caller is allowed to see, as a reusable predicate.
 *
 * `listProjects` worked out the visible project set inline: owned, plus every
 * project in an organization the user belongs to, plus every project they
 * collaborate on. Search, workload and my-work all need exactly that same set —
 * and a search tool that computes it even slightly differently is a
 * cross-tenant leak, because it returns rows the model then quotes verbatim.
 *
 * So it is computed once, here, and the definition matches what
 * `assertProjectAccess` will subsequently allow for "read".
 */

import "server-only";

import { TRPCError } from "@trpc/server";
import { eq, inArray, or, type SQL } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import {
  organizationMembers,
  projectCollaborators,
  projects,
} from "~/server/db/schema";

export function requireUser(ctx: TRPCContext): string {
  const userId = ctx.session?.user?.id;
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

export interface VisibleScope {
  userId: string;
  /** Organizations the caller is a member of. */
  orgIds: number[];
  /** Projects the caller collaborates on directly. */
  collabProjectIds: number[];
}

export async function loadVisibleScope(
  ctx: TRPCContext,
  userId: string,
): Promise<VisibleScope> {
  const [memberships, collaborations] = await Promise.all([
    ctx.db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId)),
    ctx.db
      .select({ projectId: projectCollaborators.projectId })
      .from(projectCollaborators)
      .where(eq(projectCollaborators.collaboratorId, userId)),
  ]);

  return {
    userId,
    orgIds: memberships.map((m) => m.organizationId),
    collabProjectIds: collaborations.map((c) => c.projectId),
  };
}

/**
 * A `where` fragment selecting the projects this caller may read.
 *
 * Never returns undefined: `or()` with a single clause still narrows to
 * ownership, so a user with no memberships sees only their own projects rather
 * than an unfiltered table.
 */
export function visibleProjectsWhere(scope: VisibleScope): SQL {
  return or(
    eq(projects.createdById, scope.userId),
    ...(scope.orgIds.length
      ? [inArray(projects.organizationId, scope.orgIds)]
      : []),
    ...(scope.collabProjectIds.length
      ? [inArray(projects.id, scope.collabProjectIds)]
      : []),
  )!;
}

/**
 * The concrete ids the caller may read.
 *
 * Search needs ids rather than a join predicate, because it filters child rows
 * (tasks, comments) by their parent project.
 */
export async function visibleProjectIds(
  ctx: TRPCContext,
  userId: string,
): Promise<number[]> {
  const scope = await loadVisibleScope(ctx, userId);
  const rows = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(visibleProjectsWhere(scope));
  return rows.map((r) => r.id);
}
