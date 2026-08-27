/**
 * F-3 — read the numbers the database has been collecting all along.
 *
 * `ai_messages` has carried `model`, `promptTokens`, `completionTokens` and
 * `latencyMs` on every row since the table was created, with a comment saying
 * they exist "so a quality or spend regression can be investigated after the fact
 * rather than reproduced by hand". Nothing ever read them. This is the read side.
 *
 * Everything here aggregates in SQL rather than pulling rows into Node: the whole
 * point is that it stays cheap enough to look at often, and a dashboard that
 * costs a table scan is a dashboard nobody opens twice.
 *
 * Scoped to the calling user. A cross-tenant version belongs behind an admin
 * check that KAIROS does not currently have a role for — offering it here would
 * mean inventing one, and inventing an admin role in a metrics module is how
 * authorization bugs start.
 */

import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiConversations, aiMessages } from "~/server/db/schema";

export interface UsageWindow {
  days: number;
  totalMessages: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  /** Provider-reported cache hits are not stored per message, so this is spend. */
  totalTokens: number;
}

export interface LatencyStats {
  agentId: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface DailyPoint {
  day: string;
  messages: number;
  tokens: number;
}

export interface AiMetrics {
  window: UsageWindow;
  latencyByAgent: LatencyStats[];
  daily: DailyPoint[];
  modelMix: Array<{ model: string; calls: number }>;
  conversations: { total: number; titled: number; summarized: number };
}

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getAiMetrics(
  ctx: TRPCContext,
  userId: string,
  days = 30,
): Promise<AiMetrics> {
  const from = since(days);

  // Only the caller's own messages. The join is what scopes it: `ai_messages`
  // has no user column, so without this every metric would be global.
  const mine = and(
    eq(aiConversations.userId, userId),
    gte(aiMessages.createdAt, from),
  );

  const [totals] = await ctx.db
    .select({
      totalMessages: sql<number>`count(*)`.mapWith(Number),
      totalPromptTokens: sql<number>`coalesce(sum(${aiMessages.promptTokens}), 0)`.mapWith(Number),
      totalCompletionTokens: sql<number>`coalesce(sum(${aiMessages.completionTokens}), 0)`.mapWith(Number),
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(mine);

  const latencyRows = await ctx.db
    .select({
      agentId: sql<string>`coalesce(${aiMessages.agentId}, 'unknown')`,
      samples: sql<number>`count(*)`.mapWith(Number),
      p50Ms: sql<number>`coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${aiMessages.latencyMs}), 0)`.mapWith(Number),
      p95Ms: sql<number>`coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY ${aiMessages.latencyMs}), 0)`.mapWith(Number),
      maxMs: sql<number>`coalesce(max(${aiMessages.latencyMs}), 0)`.mapWith(Number),
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(and(mine, sql`${aiMessages.latencyMs} IS NOT NULL`))
    .groupBy(sql`coalesce(${aiMessages.agentId}, 'unknown')`);

  const dailyRows = await ctx.db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${aiMessages.createdAt}), 'YYYY-MM-DD')`,
      messages: sql<number>`count(*)`.mapWith(Number),
      tokens: sql<number>`coalesce(sum(coalesce(${aiMessages.promptTokens}, 0) + coalesce(${aiMessages.completionTokens}, 0)), 0)`.mapWith(Number),
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(mine)
    .groupBy(sql`date_trunc('day', ${aiMessages.createdAt})`)
    .orderBy(sql`date_trunc('day', ${aiMessages.createdAt})`);

  const modelRows = await ctx.db
    .select({
      model: sql<string>`coalesce(${aiMessages.model}, 'unrecorded')`,
      calls: sql<number>`count(*)`.mapWith(Number),
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(mine)
    .groupBy(sql`coalesce(${aiMessages.model}, 'unrecorded')`)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const [convStats] = await ctx.db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      titled: sql<number>`count(*) FILTER (WHERE ${aiConversations.title} IS NOT NULL)`.mapWith(Number),
      summarized: sql<number>`count(*) FILTER (WHERE ${aiConversations.summary} IS NOT NULL)`.mapWith(Number),
    })
    .from(aiConversations)
    .where(eq(aiConversations.userId, userId));

  const promptTokens = totals?.totalPromptTokens ?? 0;
  const completionTokens = totals?.totalCompletionTokens ?? 0;

  return {
    window: {
      days,
      totalMessages: totals?.totalMessages ?? 0,
      totalPromptTokens: promptTokens,
      totalCompletionTokens: completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    latencyByAgent: latencyRows.map((r) => ({
      agentId: r.agentId,
      samples: r.samples,
      p50Ms: Math.round(r.p50Ms),
      p95Ms: Math.round(r.p95Ms),
      maxMs: r.maxMs,
    })),
    daily: dailyRows,
    modelMix: modelRows,
    conversations: {
      total: convStats?.total ?? 0,
      titled: convStats?.titled ?? 0,
      summarized: convStats?.summarized ?? 0,
    },
  };
}
