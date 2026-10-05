/**
 * Which names the agents answer to for a given user.
 *
 * Names belong to the workspace: with an active organization, its
 * `agent_names` apply to everyone in it. Without one, the user's own
 * `agent_names` do, so renaming still works for someone on their own.
 */

import "server-only";

import { eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { organizations, users } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { sanitizeAgentNameOverrides, type AgentNameOverrides } from "~/lib/agentNames";

const log = createLogger("agent.names");

export interface AgentNamesSource {
  overrides: AgentNameOverrides;
  /** The workspace the names belong to, or null when they are the user's own. */
  organizationId: number | null;
}

export async function loadAgentNamesSource(
  ctx: Pick<TRPCContext, "db">,
  userId: string,
): Promise<AgentNamesSource> {
  const [row] = await ctx.db
    .select({
      organizationId: organizations.id,
      orgNames: organizations.agentNames,
      userNames: users.agentNames,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.activeOrganizationId))
    .where(eq(users.id, userId))
    .limit(1);

  if (row?.organizationId != null) {
    return { overrides: sanitizeAgentNameOverrides(row.orgNames), organizationId: row.organizationId };
  }
  return { overrides: sanitizeAgentNameOverrides(row?.userNames), organizationId: null };
}

/**
 * The overrides for a prompt.
 *
 * Never throws: a name is cosmetic, and an agent turn against a database that
 * has not been migrated yet should go ahead with the default names rather than
 * fail — the same trade `resolveUserLocale` makes.
 */
export async function resolveAgentNames(
  ctx: Pick<TRPCContext, "db">,
  userId: string,
): Promise<AgentNameOverrides> {
  try {
    return (await loadAgentNamesSource(ctx, userId)).overrides;
  } catch (err) {
    log.warn("agent names unavailable, using defaults", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
