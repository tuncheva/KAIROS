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
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiUserMemory } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import {
  GLOBAL_SCOPE,
  INSTRUCTION_SCOPE,
  MAX_AGENT_FACTS,
  MAX_FACTS,
  MAX_INSTRUCTIONS,
  MAX_VALUE_CHARS,
} from "~/lib/memoryScopes";

import { requireUser } from "./tools/a1/scope";
import type { A1Tool } from "./tools/a1/types";

const log = createLogger("llm.memory");

/**
 * Scope names and caps live in `~/lib/memoryScopes` so the settings UI can read
 * the same values — this module is `server-only` and cannot be imported from a
 * client component. Re-exported here because every existing caller imports them
 * from this path.
 */
export {
  GLOBAL_SCOPE,
  INSTRUCTION_SCOPE,
  MAX_AGENT_FACTS,
  MAX_FACTS,
  MAX_INSTRUCTIONS,
} from "~/lib/memoryScopes";

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
  // Instructions load for every agent, always. They are the user's standing
  // rules, so an agent that cannot see them is an agent that breaks them.
  const scopes = [GLOBAL_SCOPE, INSTRUCTION_SCOPE];
  if (agentId && agentId !== GLOBAL_SCOPE && agentId !== INSTRUCTION_SCOPE) {
    scopes.push(agentId);
  }

  return ctx.db
    .select(FACT_COLUMNS)
    .from(aiUserMemory)
    .where(
      and(eq(aiUserMemory.userId, userId), inArray(aiUserMemory.scope, scopes)),
    )
    .orderBy(asc(aiUserMemory.scope), asc(aiUserMemory.key))
    .limit(MAX_FACTS + MAX_AGENT_FACTS + MAX_INSTRUCTIONS);
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
  const instructions = facts.filter((f) => f.scope === INSTRUCTION_SCOPE);
  const scoped = facts.filter(
    (f) => f.scope !== GLOBAL_SCOPE && f.scope !== INSTRUCTION_SCOPE,
  );

  const lines: string[] = [];

  // Instructions come first, and are framed as rules rather than as knowledge.
  // Both halves of that matter. A directive listed among facts reads as one more
  // thing that happens to be true, and a model will trade "the user prefers X"
  // away against a competing consideration in a way it will not trade away
  // "always do X". Stated before the facts so a conflict resolves the right way.
  if (instructions.length) {
    lines.push(
      "",
      "## Rules this user has set",
      "Follow these in every turn. They override your own defaults, and where they conflict with anything below, they win:",
      ...instructions.map((f) => `- ${f.value}`),
    );
  }

  if (global.length) {
    lines.push(
      "",
      "## What you know about this user",
      "Established in earlier conversations, and true unless they say otherwise:",
      ...global.map((f) => `- ${f.value}`),
    );
  }

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

  // Every scope can be empty independently now, so the early return above is no
  // longer enough to guarantee there is something to say.
  if (!lines.length) return "";

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
  const limit =
    scope === INSTRUCTION_SCOPE
      ? MAX_INSTRUCTIONS
      : isGlobal
        ? MAX_FACTS
        : MAX_AGENT_FACTS;

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
    // The one scope the model may not write.
    //
    // `scope` is a free string above, deliberately — an unknown scope stores an
    // inert row rather than failing a turn. But `INSTRUCTION_SCOPE` is not inert:
    // rows there are injected into every subsequent system prompt as rules that
    // override the model's own defaults. A model that can write them can rewrite
    // its own instructions, and a user who says "remember to always skip the
    // estimate" would be handing it that ability by accident.
    //
    // Refused rather than silently rewritten to `global`, so the answer the user
    // reads is true.
    if (input.scope?.trim() === INSTRUCTION_SCOPE) {
      return {
        stored: false,
        key: input.key,
        message:
          "Standing rules can only be set by you, in Settings → AI. I can remember it as a preference instead if you'd like.",
      };
    }

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

    // Deleting is gated for the same reason writing is, and it is the easier
    // mistake to overlook: this tool matches on `key` across every scope, so
    // without the exclusion a model asked to "forget the estimate thing" would
    // quietly remove a standing rule the user set deliberately. Rules are
    // removed in settings, by the person who wrote them.
    const deleted = await ctx.db
      .delete(aiUserMemory)
      .where(
        and(
          eq(aiUserMemory.userId, userId),
          eq(aiUserMemory.key, input.key),
          ne(aiUserMemory.scope, INSTRUCTION_SCOPE),
        ),
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
