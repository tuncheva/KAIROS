/**
 * C-2 — durable facts the assistant carries between conversations.
 *
 * The rolling summary in `conversations.ts` keeps one thread coherent. This keeps
 * the *assistant* coherent: the things that are true every day — that a sprint
 * runs Monday to Friday, that this user wants tasks written in Bulgarian, that
 * "urgent" means within 48 hours here — and that otherwise had to be restated in
 * every new conversation.
 *
 * Three rules make this safe to have at all:
 *
 * 1. **Nothing is written by inference.** A row exists because the user said to
 *    remember something, in as many words, and the model called `rememberFact`.
 *    An assistant that silently accumulates conclusions about you is a liability,
 *    not a feature.
 * 2. **Everything is visible and deletable.** `settings.aiMemory` lists every row
 *    verbatim with a delete button. A memory you cannot inspect is a memory you
 *    cannot correct.
 * 3. **It is capped.** {@link MAX_FACTS} rows, each bounded, so memory can never
 *    become the dominant term in the prompt or a way to smuggle a large payload
 *    into every future turn.
 *
 * On A1's read-only invariant: `rememberFact` and `forgetFact` are the only tools
 * A1 holds that write anything, and what they write is not workspace data — it is
 * the caller's own row in the caller's own preference table. No project, task,
 * note or event can be reached from here. A1 still cannot change anything a
 * teammate would see.
 */

import "server-only";

import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiUserMemory } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import { requireUser } from "./tools/a1/scope";
import type { A1Tool } from "./tools/a1/types";

const log = createLogger("llm.memory");

/**
 * How many facts may exist per user.
 *
 * Chosen so the block stays a rounding error against a system prompt: twenty
 * facts at 200 characters is under 1.5 KB, which is smaller than the tool
 * definitions already in every request.
 */
export const MAX_FACTS = 20;
const MAX_VALUE_CHARS = 200;

export interface MemoryFact {
  id: number;
  key: string;
  value: string;
  updatedAt: Date;
}

export async function loadUserMemory(
  ctx: TRPCContext,
  userId: string,
): Promise<MemoryFact[]> {
  return ctx.db
    .select({
      id: aiUserMemory.id,
      key: aiUserMemory.key,
      value: aiUserMemory.value,
      updatedAt: aiUserMemory.updatedAt,
    })
    .from(aiUserMemory)
    .where(eq(aiUserMemory.userId, userId))
    .orderBy(asc(aiUserMemory.key))
    .limit(MAX_FACTS);
}

/**
 * The memory block for the system prompt.
 *
 * Returns an empty string rather than an empty section when there is nothing to
 * say — an always-present "Known facts: (none)" heading is prompt weight that
 * buys nothing, and invites the model to comment on its own emptiness.
 */
export function formatMemoryForPrompt(facts: MemoryFact[]): string {
  if (!facts.length) return "";
  return [
    "",
    "## What you know about this user",
    "Established in earlier conversations, and true unless they say otherwise:",
    ...facts.map((f) => `- ${f.value}`),
    "",
  ].join("\n");
}

export async function deleteFact(
  ctx: TRPCContext,
  userId: string,
  id: number,
): Promise<void> {
  await ctx.db
    .delete(aiUserMemory)
    .where(and(eq(aiUserMemory.id, id), eq(aiUserMemory.userId, userId)));
}

export async function clearMemory(
  ctx: TRPCContext,
  userId: string,
): Promise<void> {
  await ctx.db.delete(aiUserMemory).where(eq(aiUserMemory.userId, userId));
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type RememberInput = { key: string; value: string };

export const rememberFactTool: A1Tool<
  "rememberFact",
  RememberInput,
  { stored: boolean; key: string; message: string }
> = {
  name: "rememberFact",
  inputSchema: z
    .object({
      key: z
        .string()
        .min(2)
        .max(64)
        .regex(
          /^[a-z0-9_]+$/,
          "Use a short lower_snake_case handle, e.g. sprint_cadence.",
        ),
      value: z.string().min(2).max(MAX_VALUE_CHARS),
    })
    .strict(),
  outputSchema: z.custom<{ stored: boolean; key: string; message: string }>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    const [{ count } = { count: 0 }] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(aiUserMemory)
      .where(eq(aiUserMemory.userId, userId));

    const [existing] = await ctx.db
      .select({ id: aiUserMemory.id })
      .from(aiUserMemory)
      .where(
        and(eq(aiUserMemory.userId, userId), eq(aiUserMemory.key, input.key)),
      )
      .limit(1);

    // The cap applies to new keys only — correcting an existing fact must never
    // be the thing that fails, or the user is stuck with a wrong memory.
    if (!existing && count >= MAX_FACTS) {
      return {
        stored: false,
        key: input.key,
        message: `I'm already remembering ${String(MAX_FACTS)} things, which is my limit. Ask me to forget one first — they're all listed in Settings → AI Memory.`,
      };
    }

    if (existing) {
      await ctx.db
        .update(aiUserMemory)
        .set({ value: input.value, updatedAt: new Date() })
        .where(eq(aiUserMemory.id, existing.id));
    } else {
      await ctx.db.insert(aiUserMemory).values({
        userId,
        key: input.key,
        value: input.value,
      });
    }

    log.debug("stored a user fact", { userId, key: input.key });

    return {
      stored: true,
      key: input.key,
      message: existing ? "Updated what I remembered." : "Noted.",
    };
  },
};

export const forgetFactTool: A1Tool<
  "forgetFact",
  { key: string },
  { forgotten: boolean; message: string }
> = {
  name: "forgetFact",
  inputSchema: z.object({ key: z.string().min(2).max(64) }).strict(),
  outputSchema: z.custom<{ forgotten: boolean; message: string }>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    const deleted = await ctx.db
      .delete(aiUserMemory)
      .where(
        and(eq(aiUserMemory.userId, userId), eq(aiUserMemory.key, input.key)),
      )
      .returning({ id: aiUserMemory.id });

    return deleted.length
      ? { forgotten: true, message: "Forgotten." }
      : {
          forgotten: false,
          message: `I wasn't remembering anything under "${input.key}".`,
        };
  },
};
