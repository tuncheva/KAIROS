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
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiUserMemory } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import { requireUser } from "./tools/a1/scope";
import type { A1Tool } from "./tools/a1/types";

const log = createLogger("llm.memory");

/** The scope value for facts that apply to every agent. */
export const GLOBAL_SCOPE = "global";

/**
 * How many global facts may exist per user.
 *
 * Chosen so the block stays a rounding error against a system prompt: twenty
 * facts at 200 characters is under 1.5 KB, which is smaller than the tool
 * definitions already in every request.
 */
export const MAX_FACTS = 20;

/**
 * How many facts may exist per agent, on top of the global set.
 *
 * Deliberately smaller. The property worth preserving is not "20 rows" but "the
 * memory block never dominates the prompt", and only two scopes are ever loaded
 * at once — global plus the agent running. Ten keeps the worst case at 30 facts
 * (~6 KB) no matter how many agents accumulate memories, where a flat 20 per
 * scope across seven agents would have read as 140 rows to a reader of the
 * settings page while still only ever injecting 40.
 */
export const MAX_AGENT_FACTS = 10;

const MAX_VALUE_CHARS = 200;

export interface MemoryFact {
  id: number;
  key: string;
  value: string;
  /** `'global'`, or the id of the agent this fact belongs to. */
  scope: string;
  updatedAt: Date;
}

const FACT_COLUMNS = {
  id: aiUserMemory.id,
  key: aiUserMemory.key,
  value: aiUserMemory.value,
  scope: aiUserMemory.scope,
  updatedAt: aiUserMemory.updatedAt,
};

/**
 * The facts that apply to one agent: the global set, plus that agent's own.
 *
 * Called per turn from the context builders, so it is deliberately one query.
 * Passing no `agentId` returns only the global facts, which is what a caller
 * that has no agent in hand should see — not everything.
 */
export async function loadUserMemory(
  ctx: TRPCContext,
  userId: string,
  agentId?: string,
): Promise<MemoryFact[]> {
  const scopes =
    agentId && agentId !== GLOBAL_SCOPE ? [GLOBAL_SCOPE, agentId] : [GLOBAL_SCOPE];

  return ctx.db
    .select(FACT_COLUMNS)
    .from(aiUserMemory)
    .where(
      and(eq(aiUserMemory.userId, userId), inArray(aiUserMemory.scope, scopes)),
    )
    .orderBy(asc(aiUserMemory.scope), asc(aiUserMemory.key))
    .limit(MAX_FACTS + MAX_AGENT_FACTS);
}

/**
 * Every fact the user has, across all scopes.
 *
 * For the settings editor, which has to show what it can delete — including
 * facts scoped to an agent the user is not currently talking to.
 */
export async function loadAllUserMemory(
  ctx: TRPCContext,
  userId: string,
): Promise<MemoryFact[]> {
  return ctx.db
    .select(FACT_COLUMNS)
    .from(aiUserMemory)
    .where(eq(aiUserMemory.userId, userId))
    .orderBy(asc(aiUserMemory.scope), asc(aiUserMemory.key));
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

  const global = facts.filter((f) => f.scope === GLOBAL_SCOPE);
  const scoped = facts.filter((f) => f.scope !== GLOBAL_SCOPE);

  const lines = [
    "",
    "## What you know about this user",
    "Established in earlier conversations, and true unless they say otherwise:",
    ...global.map((f) => `- ${f.value}`),
  ];

  // Kept as a separate heading rather than merged into one list: these were set
  // for *this* agent specifically, and a model that cannot tell the difference
  // will happily apply a note-taking preference to a task plan.
  if (scoped.length) {
    lines.push(
      "",
      "They set these for you in particular, and they take precedence:",
      ...scoped.map((f) => `- ${f.value}`),
    );
  }

  lines.push("");
  return lines.join("\n");
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

export interface UpsertResult {
  stored: boolean;
  key: string;
  message: string;
}

/**
 * Write one fact, creating or correcting it.
 *
 * The single write path, shared by the `rememberFact` tool and the settings
 * editor, so the cap and the scope rules cannot drift between "the model wrote
 * it" and "the user typed it".
 *
 * The cap applies to *new* keys only. Correcting an existing fact must never be
 * the operation that fails, or a user who hits the limit is stuck with a wrong
 * memory and no way to fix it.
 */
export async function upsertFact(
  ctx: TRPCContext,
  userId: string,
  input: { key: string; value: string; scope?: string },
): Promise<UpsertResult> {
  const scope = input.scope?.trim() ?? GLOBAL_SCOPE;
  const isGlobal = scope === GLOBAL_SCOPE;
  const limit = isGlobal ? MAX_FACTS : MAX_AGENT_FACTS;

  const [existing] = await ctx.db
    .select({ id: aiUserMemory.id })
    .from(aiUserMemory)
    .where(
      and(
        eq(aiUserMemory.userId, userId),
        eq(aiUserMemory.scope, scope),
        eq(aiUserMemory.key, input.key),
      ),
    )
    .limit(1);

  if (existing) {
    await ctx.db
      .update(aiUserMemory)
      .set({ value: input.value, updatedAt: new Date() })
      .where(eq(aiUserMemory.id, existing.id));

    log.debug("updated a user fact", { userId, key: input.key, scope });
    return { stored: true, key: input.key, message: "Updated what I remembered." };
  }

  // Counted per scope, not in total: a full global set must not block a user
  // from teaching one agent something, and vice versa.
  const [{ count } = { count: 0 }] = await ctx.db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(aiUserMemory)
    .where(
      and(eq(aiUserMemory.userId, userId), eq(aiUserMemory.scope, scope)),
    );

  if (count >= limit) {
    return {
      stored: false,
      key: input.key,
      message: `I'm already remembering ${String(limit)} things${
        isGlobal ? "" : " for this agent"
      }, which is my limit. Ask me to forget one first — they're all listed in Settings → AI Memory.`,
    };
  }

  await ctx.db.insert(aiUserMemory).values({
    userId,
    key: input.key,
    value: input.value,
    scope,
  });

  log.debug("stored a user fact", { userId, key: input.key, scope });
  return { stored: true, key: input.key, message: "Noted." };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** The key shape both the tool and the settings editor accept. */
export const FactKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9_]+$/,
    "Use a short lower_snake_case handle, e.g. sprint_cadence.",
  );

export const FactValueSchema = z.string().min(2).max(MAX_VALUE_CHARS);

type RememberInput = { key: string; value: string; scope?: string };

export const rememberFactTool: A1Tool<
  "rememberFact",
  RememberInput,
  UpsertResult
> = {
  name: "rememberFact",
  inputSchema: z
    .object({
      key: FactKeySchema,
      value: FactValueSchema,
      /**
       * Which agent the fact is for. Omitted means every agent.
       *
       * Not validated against the registry here: an unknown scope stores a fact
       * no agent will ever load, which is inert, where rejecting it would fail a
       * turn over a detail the user did not ask about. The settings editor is
       * where scopes are chosen from a real list.
       */
      scope: z.string().min(2).max(40).optional(),
    })
    .strict(),
  outputSchema: z.custom<UpsertResult>(),

  async execute(ctx, input) {
    return upsertFact(ctx, requireUser(ctx), input);
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
