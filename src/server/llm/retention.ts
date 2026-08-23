/**
 * Ageing out chat history on plans that do not keep it forever.
 *
 * Worth stating the inversion plainly, because it is the opposite of how this
 * feature reads on a pricing page. "Unlimited history for Pro" needed no code at
 * all — `ai_conversations` and `ai_messages` never had a retention job, so
 * everything was already kept indefinitely for everyone. What needed building is
 * the *limit* for Free.
 *
 * Two rules shape the implementation:
 *
 * 1. **Messages are deleted; conversations are not.** `conversations.ts` folds
 *    aged-out turns into `ai_conversations.summary` and tracks how far it has
 *    got with `summarizedThroughId`. Deleting the messages under that pointer is
 *    fine and in fact desirable — the summary is what survives. Deleting the
 *    conversation row would destroy the summary too, and with it the only
 *    remaining record of a thread the user may still see in their list.
 * 2. **Nothing is deleted for a plan with no limit.** `historyDays: null` means
 *    indefinitely, and a null must never be coerced into a number here. Today
 *    every user resolves to Pro, so this function is a no-op in production — by
 *    design. It is being written now so the switch to real plans is a change in
 *    one file rather than a new feature under deadline.
 *
 * Deliberately not a hard delete of "everything old". A user's most recent
 * conversation is left intact regardless of age: someone who returns after three
 * months should find the thread they left, not an empty product.
 */

import "server-only";

import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { aiConversations, aiMessages } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

const log = createLogger("llm.retention");

/** How many users one sweep will consider. Bounded like the schedule sweep. */
const USER_BATCH = 500;

export interface CullReport {
  usersConsidered: number;
  messagesDeleted: number;
  conversationsKept: number;
}

/**
 * Delete messages older than a plan's retention window.
 *
 * Takes the window as an argument rather than reading entitlements per user: the
 * caller decides policy, this decides mechanics. That keeps it testable and stops
 * a billing lookup appearing inside a delete loop.
 */
export async function cullUserMessages(input: {
  userId: string;
  historyDays: number | null;
  now?: Date;
}): Promise<{ messagesDeleted: number; conversationsKept: number }> {
  const { userId, historyDays } = input;
  const now = input.now ?? new Date();

  // The load-bearing guard. `null` is unlimited, and a plan with no limit must
  // never fall through to a numeric comparison.
  if (historyDays === null || historyDays <= 0) {
    return { messagesDeleted: 0, conversationsKept: 0 };
  }

  const cutoff = new Date(now.getTime() - historyDays * 86_400_000);

  // The thread the user would return to. Spared whatever its age, because the
  // alternative is a returning user finding their last conversation gone.
  const [mostRecent] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(eq(aiConversations.userId, userId))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(1);

  const conversationIds = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      mostRecent
        ? and(
            eq(aiConversations.userId, userId),
            ne(aiConversations.id, mostRecent.id),
          )
        : eq(aiConversations.userId, userId),
    );

  if (!conversationIds.length) {
    return { messagesDeleted: 0, conversationsKept: mostRecent ? 1 : 0 };
  }

  const deleted = await db
    .delete(aiMessages)
    .where(
      and(
        inArray(
          aiMessages.conversationId,
          conversationIds.map((c) => c.id),
        ),
        lt(aiMessages.createdAt, cutoff),
      ),
    )
    .returning({ id: aiMessages.id });

  return {
    messagesDeleted: deleted.length,
    conversationsKept: mostRecent ? 1 : 0,
  };
}

/**
 * Sweep every user whose plan has a retention window.
 *
 * `resolveHistoryDays` is injected so this module does not import the billing
 * layer: retention is a mechanism and plans are a policy, and wiring them
 * together here would mean a schema change to `Entitlements` could break a
 * delete loop.
 */
export async function cullExpiredHistory(input: {
  resolveHistoryDays: (userId: string) => Promise<number | null> | number | null;
  now?: Date;
}): Promise<CullReport> {
  const now = input.now ?? new Date();

  const users = await db
    .selectDistinct({ userId: aiConversations.userId })
    .from(aiConversations)
    .limit(USER_BATCH);

  const report: CullReport = {
    usersConsidered: users.length,
    messagesDeleted: 0,
    conversationsKept: 0,
  };

  for (const { userId } of users) {
    try {
      const historyDays = await input.resolveHistoryDays(userId);
      const result = await cullUserMessages({ userId, historyDays, now });

      report.messagesDeleted += result.messagesDeleted;
      report.conversationsKept += result.conversationsKept;
    } catch (err) {
      // One user's failure is one user's failure — the same rule the scheduled
      // sweep follows. A batch that aborts on the first bad row silently stops
      // culling for everyone after it.
      log.error("history cull failed for user", { userId, err });
    }
  }

  if (report.messagesDeleted) {
    log.info("history cull complete", { ...report });
  }

  return report;
}

/**
 * Full-text search across a user's own messages.
 *
 * The half of "unlimited history" that is actually visible. Keeping every message
 * is worth nothing if the only way back to a decision from last quarter is
 * scrolling, so the retention difference is felt on day one rather than on day
 * thirty-one.
 *
 * `plainto_tsquery` rather than `to_tsquery`: it treats the input as words rather
 * than as query syntax, so a user typing `invoice & export` gets a search for
 * that phrase instead of a syntax error.
 */
export async function searchMessages(input: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<
  Array<{
    conversationId: string;
    conversationTitle: string | null;
    content: string;
    role: string;
    createdAt: Date;
  }>
> {
  const query = input.query.trim();
  if (query.length < 2) return [];

  return db
    .select({
      conversationId: aiMessages.conversationId,
      conversationTitle: aiConversations.title,
      content: aiMessages.content,
      role: aiMessages.role,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .innerJoin(
      aiConversations,
      eq(aiMessages.conversationId, aiConversations.id),
    )
    .where(
      and(
        // Ownership is enforced through the join, not by trusting the caller.
        eq(aiConversations.userId, input.userId),
        sql`to_tsvector('simple', ${aiMessages.content}) @@ plainto_tsquery('simple', ${query})`,
      ),
    )
    .orderBy(desc(aiMessages.createdAt))
    .limit(Math.min(input.limit ?? 25, 100));
}
