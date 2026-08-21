/**
 * Conversation persistence for the AI chat.
 *
 * History used to be whatever was in React state, mapped from the *rendered*
 * bubble text — so the model received strings like "3 creates · 2 updates 👇 You
 * can edit the details below" as its own prior turns, and a reload erased
 * everything. What is stored here is what the model actually said.
 *
 * Two things layered on top of that (C-1, C-3):
 *
 * - **A rolling summary.** Replaying the last 16 turns raw meant the beginning of
 *   a long conversation silently vanished — the model would re-ask something it
 *   had already been told, and the prompt grew until it did. Older turns are now
 *   folded into a summary that is replayed *in front of* the recent ones, so
 *   context stays bounded without losing what was established early.
 * - **A title.** The `title` column existed from the beginning and nothing ever
 *   wrote it, so there was no way back to a past conversation except
 *   `findLatestConversation`. It is generated once, from the first exchange.
 *
 * Both use the cheap model tier: they are short, mechanical, and were not worth
 * the reasoning model. Both run *after* the response has been sent, so neither
 * one costs the user any latency.
 */

import "server-only";

import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiConversations, aiMessages } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import { chatCompletion } from "./core/modelClient";

const log = createLogger("llm.conversations");

/** Recent turns replayed to the model verbatim. */
const REPLAY_LIMIT = 10;

/**
 * Total messages that may exist before summarization kicks in.
 *
 * Above this, everything older than the replay window gets folded into the
 * summary. Set above `REPLAY_LIMIT` with headroom so a short conversation never
 * pays for a summarization call it does not need.
 */
const SUMMARIZE_THRESHOLD = 16;

/** Hard cap on the stored summary, so it cannot itself become the context problem. */
const MAX_SUMMARY_CHARS = 1_200;

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

export interface ReplayContext {
  /** What was established in turns that have aged out of the replay window. */
  summary: string | null;
  /** The recent turns, oldest first. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * The context to replay into the model: the rolling summary, plus recent turns.
 *
 * Returns an empty context rather than throwing when the conversation does not
 * belong to the caller — a stale id should degrade to "no history", not a 500.
 */
export async function loadHistory(
  ctx: TRPCContext,
  conversationId: string,
  userId: string,
  limit = REPLAY_LIMIT,
): Promise<ReplayContext> {
  const [conversation] = await ctx.db
    .select({ id: aiConversations.id, summary: aiConversations.summary })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.userId, userId),
      ),
    )
    .limit(1);

  if (!conversation) return { summary: null, messages: [] };

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
  const messages = rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .reverse()
    .map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
    }));

  return { summary: conversation.summary, messages };
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

// ---------------------------------------------------------------------------
// C-3 — titles and the history browser
// ---------------------------------------------------------------------------

export interface ConversationSummaryRow {
  id: string;
  title: string | null;
  projectId: number | null;
  updatedAt: Date;
  messageCount: number;
}

/** The caller's conversations, most recently active first. */
export async function listConversations(
  ctx: TRPCContext,
  userId: string,
  limit = 30,
): Promise<ConversationSummaryRow[]> {
  return ctx.db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      projectId: aiConversations.projectId,
      updatedAt: aiConversations.updatedAt,
      messageCount: sql<number>`(
        SELECT count(*) FROM ${aiMessages} AS m
        WHERE m.conversation_id = ${aiConversations.id}
      )`.mapWith(Number),
    })
    .from(aiConversations)
    .where(eq(aiConversations.userId, userId))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);
}

export async function deleteConversation(
  ctx: TRPCContext,
  conversationId: string,
  userId: string,
): Promise<void> {
  // Scoped by userId in the same statement — no read-then-delete window.
  await ctx.db
    .delete(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.userId, userId),
      ),
    );
}

/**
 * Give a conversation a title, once, from its opening exchange.
 *
 * Best-effort by design: a failed title is a cosmetic loss, and it must never
 * turn a working chat turn into an error. Runs on the fast tier.
 */
export async function ensureTitle(
  ctx: TRPCContext,
  conversationId: string,
  firstUserMessage: string,
): Promise<void> {
  try {
    const [row] = await ctx.db
      .select({ title: aiConversations.title })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!row || row.title) return;

    const res = await chatCompletion({
      tier: "fast",
      temperature: 0.3,
      maxTokens: 400,
      purpose: "conversation.title",
      messages: [
        {
          role: "system",
          content:
            "Title this conversation in at most six words, in the same language as the message. " +
            "Reply with the title only — no quotes, no punctuation at the end, no preamble.",
        },
        { role: "user", content: firstUserMessage.slice(0, 1_000) },
      ],
    });

    const title = res.content.trim().replace(/^["'“”]|["'“”]$/g, "").slice(0, 120);
    if (!title) return;

    await ctx.db
      .update(aiConversations)
      .set({ title })
      .where(eq(aiConversations.id, conversationId));
  } catch (err) {
    log.warn("could not generate a conversation title", { conversationId, err });
  }
}

// ---------------------------------------------------------------------------
// C-1 — rolling summary
// ---------------------------------------------------------------------------

/**
 * Fold everything older than the replay window into the stored summary.
 *
 * Called after the response has been sent. Best-effort: if it fails, the next
 * turn simply replays the recent window without a summary, which is exactly the
 * old behaviour.
 */
export async function maybeSummarize(
  ctx: TRPCContext,
  conversationId: string,
): Promise<void> {
  try {
    const [conversation] = await ctx.db
      .select({
        summary: aiConversations.summary,
        summarizedThroughId: aiConversations.summarizedThroughId,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation) return;

    const [{ count } = { count: 0 }] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId));

    if (count <= SUMMARIZE_THRESHOLD) return;

    // The newest REPLAY_LIMIT messages stay verbatim; everything below that
    // watermark is what the summary must cover.
    const recent = await ctx.db
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(desc(aiMessages.id))
      .limit(REPLAY_LIMIT);

    const watermark = recent.at(-1)?.id;
    if (watermark === undefined) return;

    // Nothing new has aged out since the last fold.
    if (
      conversation.summarizedThroughId !== null &&
      conversation.summarizedThroughId >= watermark
    ) {
      return;
    }

    const toFold = await ctx.db
      .select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.conversationId, conversationId),
          lt(aiMessages.id, watermark),
          ...(conversation.summarizedThroughId !== null
            ? [gt(aiMessages.id, conversation.summarizedThroughId)]
            : []),
        ),
      )
      .orderBy(asc(aiMessages.id))
      .limit(60);

    if (!toFold.length) return;

    const transcript = toFold
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role}: ${m.content.slice(0, 800)}`)
      .join("\n");

    if (!transcript.trim()) return;

    const res = await chatCompletion({
      tier: "fast",
      temperature: 0.2,
      maxTokens: 1_500,
      purpose: "conversation.summarize",
      messages: [
        {
          role: "system",
          content:
            "You maintain a running summary of a conversation between a user and a project-management assistant. " +
            "Merge the earlier summary with the new turns into one summary under 150 words. " +
            "Keep decisions, stated preferences, named projects, ids and open questions. " +
            "Drop pleasantries and anything already acted on. " +
            "Write in the language the user is using. Reply with the summary only.",
        },
        {
          role: "user",
          content: `Earlier summary:\n${conversation.summary ?? "(none)"}\n\nNew turns:\n${transcript}`,
        },
      ],
    });

    const summary = res.content.trim().slice(0, MAX_SUMMARY_CHARS);
    if (!summary) return;

    await ctx.db
      .update(aiConversations)
      .set({ summary, summarizedThroughId: watermark })
      .where(eq(aiConversations.id, conversationId));

    log.debug("folded conversation history into summary", {
      conversationId,
      folded: toFold.length,
    });
  } catch (err) {
    log.warn("could not summarize conversation", { conversationId, err });
  }
}
