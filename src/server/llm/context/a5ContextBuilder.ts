/**
 * Context for A5 — Org Admin.
 *
 * Only organizations where the caller actually holds an administrative
 * capability are loaded. A5 physically cannot see the membership of an
 * organization the user merely belongs to, so it cannot propose a change there
 * for the apply step to then refuse — the model is never put in the position of
 * drafting something it was always going to be denied.
 */

import "server-only";

import { and, eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { flagsForRole, type MemberPermissionFlags } from "~/lib/permissions";
import {
  organizationMembers,
  organizations,
  users,
} from "~/server/db/schema";

import { requireUser } from "~/server/llm/tools/a1/scope";

export interface A5Member {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  isSelf: boolean;
  flags: MemberPermissionFlags;
}

export interface A5Organization {
  id: number;
  name: string;
  myRole: string;
  /** What the caller may actually do here, from their membership row. */
  myFlags: MemberPermissionFlags;
  members: A5Member[];
  adminCount: number;
}

export interface A5ContextPack {
  userId: string;
  organizations: A5Organization[];
  now: string;
}

export async function buildA5Context(input: {
  ctx: TRPCContext;
  organizationId?: number;
}): Promise<A5ContextPack> {
  const { ctx } = input;
  const userId = requireUser(ctx);

  const myMemberships = await ctx.db
    .select({
      organizationId: organizationMembers.organizationId,
      role: organizationMembers.role,
      canAddMembers: organizationMembers.canAddMembers,
      canKickMembers: organizationMembers.canKickMembers,
      canManageRoles: organizationMembers.canManageRoles,
      canAssignTasks: organizationMembers.canAssignTasks,
      canCreateProjects: organizationMembers.canCreateProjects,
      canDeleteTasks: organizationMembers.canDeleteTasks,
      canEditProjects: organizationMembers.canEditProjects,
      canViewAnalytics: organizationMembers.canViewAnalytics,
      name: organizations.name,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizationMembers.organizationId, organizations.id),
    )
    .where(
      input.organizationId !== undefined
        ? and(
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.organizationId, input.organizationId),
          )
        : eq(organizationMembers.userId, userId),
    )
    .limit(20);

  // Only orgs where the caller can do at least one administrative thing.
  const administrable = myMemberships.filter(
    (m) => m.canManageRoles || m.canKickMembers || m.canAddMembers,
  );

  const result: A5Organization[] = [];

  for (const org of administrable) {
    const rows = await ctx.db
      .select({
        userId: organizationMembers.userId,
        role: organizationMembers.role,
        canAddMembers: organizationMembers.canAddMembers,
        canAssignTasks: organizationMembers.canAssignTasks,
        canCreateProjects: organizationMembers.canCreateProjects,
        canDeleteTasks: organizationMembers.canDeleteTasks,
        canKickMembers: organizationMembers.canKickMembers,
        canManageRoles: organizationMembers.canManageRoles,
        canEditProjects: organizationMembers.canEditProjects,
        canViewAnalytics: organizationMembers.canViewAnalytics,
        name: users.name,
        email: users.email,
      })
      .from(organizationMembers)
      .leftJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, org.organizationId))
      .limit(100);

    const members: A5Member[] = rows.map((r) => ({
      userId: r.userId,
      name: r.name ?? "Unnamed",
      email: r.email,
      role: r.role,
      isSelf: r.userId === userId,
      flags: {
        canAddMembers: r.canAddMembers,
        canAssignTasks: r.canAssignTasks,
        canCreateProjects: r.canCreateProjects,
        canDeleteTasks: r.canDeleteTasks,
        canKickMembers: r.canKickMembers,
        canManageRoles: r.canManageRoles,
        canEditProjects: r.canEditProjects,
        canViewAnalytics: r.canViewAnalytics,
      },
    }));

    result.push({
      id: org.organizationId,
      name: org.name,
      myRole: org.role,
      myFlags: {
        canAddMembers: org.canAddMembers,
        canAssignTasks: org.canAssignTasks,
        canCreateProjects: org.canCreateProjects,
        canDeleteTasks: org.canDeleteTasks,
        canKickMembers: org.canKickMembers,
        canManageRoles: org.canManageRoles,
        canEditProjects: org.canEditProjects,
        canViewAnalytics: org.canViewAnalytics,
      },
      members,
      // The check that stops an organization being locked out of its own
      // administration. Counted from the role, not the flags, because the role
      // is what `updateMemberRole` rewrites the flags from.
      adminCount: members.filter((m) => flagsForRole(m.role).canManageRoles)
        .length,
    });
  }

  return { userId, organizations: result, now: new Date().toISOString() };
}
