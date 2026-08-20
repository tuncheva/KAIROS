/**
 * Conversation persistence for the AI chat.
 *
 * History used to be whatever was in React state, mapped from the *rendered*
 * bubble text — so the model received strings like "3 creates · 2 updates 👇 You
 * can edit the details below" as its own prior turns, and a reload erased
 * everything. What is stored here is what the model actually said.
 */

import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiConversations, aiMessages } from "~/server/db/schema";

/** How many past turns to replay into the model. */
const HISTORY_LIMIT = 16;

export interface StoredMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  agentId: string | null;
  draftId: string | null;
  createdAt: Date;
}

export function createConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Resolve the conversation to append to, creating one when needed.
 *
 * A conversation id supplied by the client is only accepted if it belongs to the
 * caller; anything else starts a fresh conversation rather than erroring, since
 * a stale id in localStorage should not break the chat.
 */
export async function ensureConversation(
  ctx: TRPCContext,
  input: { conversationId?: string; userId: string; projectId?: number | null },
): Promise<string> {
  if (input.conversationId) {
    const [existing] = await ctx.db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, input.conversationId),
          eq(aiConversations.userId, input.userId),
        ),
      )
      .limit(1);

    if (existing) {
      await ctx.db
        .update(aiConversations)
        .set({ updatedAt: new Date() })
        .where(eq(aiConversations.id, existing.id));
      return existing.id;
    }
  }

  const id = createConversationId();
  await ctx.db.insert(aiConversations).values({
    id,
    userId: input.userId,
    projectId: input.projectId ?? null,
  });
  return id;
}

/** The recent turns of a conversation, oldest first, for replay into the model. */
export async function loadHistory(
  ctx: TRPCContext,
  conversationId: string,
  userId: string,
  limit = HISTORY_LIMIT,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const [conversation] = await ctx.db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.userId, userId),
      ),
    )
    .limit(1);

  if (!conversation) return [];

  const rows = await ctx.db
    .select({
      role: aiMessages.role,
      content: aiMessages.content,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt))
    .limit(limit);

  // Tool messages are excluded: their results belong to the turn that fetched
  // them, and replaying them without the matching tool_call ids is invalid.
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .reverse()
    .map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
    }));
}

export interface AppendMessageInput {
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  agentId?: string | null;
  draftId?: string | null;
  toolCalls?: unknown;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
}

export async function appendMessage(
  ctx: TRPCContext,
  input: AppendMessageInput,
): Promise<void> {
  await ctx.db.insert(aiMessages).values({
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    agentId: input.agentId ?? null,
    draftId: input.draftId ?? null,
    toolCallsJson: input.toolCalls ? JSON.stringify(input.toolCalls) : null,
    model: input.model ?? null,
    promptTokens: input.promptTokens ?? null,
    completionTokens: input.completionTokens ?? null,
    latencyMs: input.latencyMs ?? null,
  });

  await ctx.db
    .update(aiConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiConversations.id, input.conversationId));
}

/** Full transcript for rehydrating the UI after a reload. */
export async function loadConversation(
  ctx: TRPCContext,
  conversationId: string,
  userId: string,
): Promise<StoredMessage[]> {
  const [conversation] = await ctx.db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.userId, userId),
      ),
    )
    .limit(1);

  if (!conversation) return [];

  const rows = await ctx.db
    .select({
      role: aiMessages.role,
      content: aiMessages.content,
      agentId: aiMessages.agentId,
      draftId: aiMessages.draftId,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.createdAt))
    .limit(200);

  // Tool results are internal to a turn, and `system` exists in the column's
  // enum only because the type predates this table — nothing writes it. Narrow
  // to the roles the transcript actually renders.
  return rows.filter(
    (r): r is StoredMessage => r.role === "user" || r.role === "assistant",
  );
}

/** The caller's most recent conversation for a given scope, if any. */
export async function findLatestConversation(
  ctx: TRPCContext,
  userId: string,
  projectId?: number | null,
): Promise<string | null> {
  const [row] = await ctx.db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      projectId != null
        ? and(
            eq(aiConversations.userId, userId),
            eq(aiConversations.projectId, projectId),
          )
        : eq(aiConversations.userId, userId),
    )
    .orderBy(desc(aiConversations.updatedAt))
    .limit(1);

  return row?.id ?? null;
}
