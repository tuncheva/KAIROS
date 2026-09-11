/**
 * Context for A6 — Project Manager.
 *
 * Loads the user's visible projects and their org membership flags so the agent
 * can propose create/update/archive operations against what is actually reachable.
 */

import "server-only";

import { eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import {
  organizationMembers,
  projects,
} from "~/server/db/schema";
import { resolveUserLocale, type SupportedLocale } from "~/server/llm/locale";
import { loadUserMemory, type MemoryFact } from "~/server/llm/memory";
import {
  loadVisibleScope,
  visibleProjectsWhere,
  requireUser,
} from "~/server/llm/tools/a1/scope";

export interface A6Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  organizationId: number | null;
}

export interface A6OrgMembership {
  orgId: number;
  canCreateProjects: boolean;
  canEditProjects: boolean;
  canDeleteTasks: boolean;
}

export interface A6ContextPack {
  userId: string;
  projects: A6Project[];
  orgMemberships: A6OrgMembership[];
  locale: SupportedLocale;
  memory: MemoryFact[];
  now: string;
}

export async function buildA6Context(input: {
  ctx: TRPCContext;
  organizationId?: number;
}): Promise<A6ContextPack> {
  const { ctx } = input;
  const userId = requireUser(ctx);

  const scope = await loadVisibleScope(ctx, userId);

  const visibleProjects = await ctx.db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      status: projects.status,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(visibleProjectsWhere(scope))
    .limit(200);

  // Load org membership flags for all orgs the user belongs to
  const memberships = scope.orgIds.length
    ? await ctx.db
        .select({
          organizationId: organizationMembers.organizationId,
          canCreateProjects: organizationMembers.canCreateProjects,
          canEditProjects: organizationMembers.canEditProjects,
          canDeleteTasks: organizationMembers.canDeleteTasks,
        })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, userId))
    : [];

  const orgMemberships: A6OrgMembership[] = memberships.map((m) => ({
    orgId: m.organizationId,
    canCreateProjects: m.canCreateProjects,
    canEditProjects: m.canEditProjects,
    canDeleteTasks: m.canDeleteTasks,
  }));

  const [memory, locale] = await Promise.all([
    loadUserMemory(ctx, userId, "project_manager"),
    resolveUserLocale(ctx, userId),
  ]);

  return {
    userId,
    projects: visibleProjects,
    orgMemberships,
    locale,
    memory,
    now: new Date().toISOString(),
  };
}
