/**
 * How the agents are configured for a given user: what they are called and
 * the settings in force.
 *
 * Both belong to the workspace first: with an active organization, its
 * `agent_names` and workspace-scoped `agent_settings` apply to everyone in it.
 * Without one, the user's own columns stand in, so someone working alone can
 * still rename and tune. Personal settings always come from the user. One query
 * covers all of it, since every agent turn needs it.
 */

import "server-only";

import { eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { organizations, users } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { sanitizeAgentNameOverrides, type AgentNameOverrides } from "~/lib/agentNames";
import {
  defaultAgentSettings,
  resolveAgentSettings,
  type ResolvedAgentSettings,
} from "~/lib/agentSettings";

const log = createLogger("agent.config");

export interface AgentConfigSource {
  names: AgentNameOverrides;
  settings: ResolvedAgentSettings;
  /** The workspace the names and workspace settings belong to, or null when they are the user's own. */
  organizationId: number | null;
}

export async function loadAgentConfigSource(
  ctx: Pick<TRPCContext, "db">,
  userId: string,
): Promise<AgentConfigSource> {
  const [row] = await ctx.db
    .select({
      organizationId: organizations.id,
      orgNames: organizations.agentNames,
      orgSettings: organizations.agentSettings,
      userNames: users.agentNames,
      userSettings: users.agentSettings,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.activeOrganizationId))
    .where(eq(users.id, userId))
    .limit(1);

  const inWorkspace = row?.organizationId != null;
  return {
    names: sanitizeAgentNameOverrides(inWorkspace ? row.orgNames : row?.userNames),
    settings: resolveAgentSettings({
      workspace: inWorkspace ? row.orgSettings : row?.userSettings,
      personal: row?.userSettings,
    }),
    organizationId: inWorkspace ? row.organizationId : null,
  };
}

export interface AgentConfig {
  names: AgentNameOverrides;
  settings: ResolvedAgentSettings;
}

/**
 * Names and settings for a prompt.
 *
 * Never throws: both are refinements, and an agent turn against a database
 * that has not been migrated yet should go ahead on the defaults rather than
 * fail — the same trade `resolveUserLocale` makes.
 */
export async function resolveAgentConfig(
  ctx: Pick<TRPCContext, "db">,
  userId: string,
): Promise<AgentConfig> {
  try {
    const { names, settings } = await loadAgentConfigSource(ctx, userId);
    return { names, settings };
  } catch (err) {
    log.warn("agent config unavailable, using defaults", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { names: {}, settings: defaultAgentSettings() };
  }
}
