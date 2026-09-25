/**
 * A1 — Workspace Concierge: answers questions about the caller's workspace.
 *
 * Read-only. When the user wants something written, A1 emits a handoff and the
 * matching sub-agent (A2/A3/A4) owns the draft → confirm → apply lifecycle.
 */

import { TRPCError } from "@trpc/server";

import type { TRPCContext } from "~/server/api/trpc";
import { a1WorkspaceConciergeProfile } from "~/server/llm/profiles/a1WorkspaceConcierge";
import {
  A1OutputSchema,
  type A1Output,
} from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import {
  buildA1Context,
  type A1ContextPack,
} from "~/server/llm/context/a1ContextBuilder";
import { getA1SystemPrompt } from "~/server/llm/prompts/a1Prompts";
import { replyLanguageMessages } from "~/server/llm/prompts/replyLanguage";
import {
  parseAndValidate,
  type ParseError,
  type ParseResult,
} from "~/server/llm/core/jsonRepair";
import {
  runToolLoop,
  type ToolLoopOptions,
  type ToolLoopResult,
} from "~/server/llm/core/toolLoop";
import { A1_READ_TOOLS } from "~/server/llm/tools/a1/readTools";
import { toolDefinitionsFor } from "~/server/llm/tools/a1/toolDefinitions";

import {
  createDraftId,
  requireUserId,
  type AgentDraftInput,
  type AgentDraftResult,
  log,
} from "./shared";

/**
 * What A1 answers with when the model is unavailable.
 *
 * Deliberately does not summarise the workspace: an outage is not a reason to
 * start listing projects the user did not ask about.
 */
/**
 * Marks a turn as the hand-built outage reply rather than model output.
 *
 * Read by `isFallbackTurn` so those turns can be kept out of the history the
 * model sees. They are persisted like any other turn, so a thread that hit an
 * outage accumulates assistant messages that all read "I'm having trouble
 * generating an AI response right now". Fed back as context, that is a pattern
 * the model will happily continue once it recovers — answering a cheerful
 * "hello" with the outage text, from a call that succeeded.
 */
export const AI_UNAVAILABLE_REF = "ai_unavailable";

/**
 * True for a stored assistant turn that was the fallback, not an answer.
 *
 * Deliberately a substring test on the raw JSON rather than a parse: history
 * rows are arbitrary stored text, and this runs on every message of every turn.
 */
export function isFallbackTurn(content: string): boolean {
  return content.includes(`"${AI_UNAVAILABLE_REF}"`);
}

function buildFallbackResponse(
  input: AgentDraftInput,
  locale?: string,
): A1Output {
  const safeScope = input.scope ?? {};
  const isBg =
    locale === "bg" ||
    (typeof input.message === "string" && /[Ѐ-ӿ]/.test(input.message));

  return {
    intent: {
      type: "answer" as const,
      scope: { orgId: safeScope.orgId, projectId: safeScope.projectId },
    },
    answer: {
      summary: isBg
        ? "В момента има проблем с генерирането на отговор от изкуствения интелект. Моля, опитайте да преформулирате въпроса си или уточнете какво ви е необходимо."
        : "I’m having trouble generating an AI response right now. Try rephrasing your question or be more specific about what you need.",
      // No bullet glyphs here: every renderer of `answer.details` adds its own,
      // and a hand-written one shows up as a doubled bullet.
      details: isBg
        ? [
            "Задайте директен въпрос (напр. „Какъв е статусът на проект X?“)",
            "Ако искате да създадете задачи, кажете „създай задачи за …“ и ще прехвърля заявката към Task Planner",
          ]
        : [
            "Ask a direct question (e.g., ‘What’s the status of Project X?’)",
            "If you want tasks created, say ‘create tasks for …’ and I’ll hand it off to the Task Planner",
          ],
    },
    // Normalized by `A1OutputSchema`'s transform on the happy path; set here
    // because a hand-built fallback never passes through it.
    handoff: undefined,
    handoffs: [],
    citations: [{ label: "fallback", ref: AI_UNAVAILABLE_REF }],
  };
}

export interface A1TurnInput {
  ctx: TRPCContext;
  userId: string;
  contextPack: A1ContextPack;
  message: string;
  conversationHistory?: AgentDraftInput["conversationHistory"];
  conversationSummary?: string | null;
  /**
   * The tools the loop may execute. Production leaves this unset and gets the
   * real read tools. The live eval passes stubs over a fixed workspace, so it
   * measures the model against the same prompt, message order and parser the
   * product uses rather than a copy of them that could drift.
   */
  registry?: ToolLoopOptions["registry"];
  signal?: AbortSignal;
  onToolCall?: (name: string) => void;
  onAnswerDelta?: (text: string) => void;
}

export interface A1TurnOutcome {
  loop: ToolLoopResult;
  /** `null` when the loop ran out of budget before producing an answer. */
  parsed: ParseResult<A1Output> | ParseError | null;
}

/**
 * The model half of an A1 turn: messages in, validated output out.
 *
 * Split from {@link a1Concierge.draft} so the live eval can run exactly this
 * without a database behind it. Everything that needs one — building the context
 * pack, choosing a fallback reply — stays in `draft`. Throws on a model failure;
 * the caller decides what the user sees.
 */
export async function runA1Turn(input: A1TurnInput): Promise<A1TurnOutcome> {
  const systemPrompt = getA1SystemPrompt(input.contextPack, input.message);

  const historyMessages = (input.conversationHistory ?? [])
    // An outage reply is not something the assistant "said" — it is what
    // this file returns when the model is unreachable. Replaying it as
    // context teaches the model that this thread answers everything with
    // it, which it then does on the next turn that succeeds.
    .filter((m) => !(m.role === "assistant" && isFallbackTurn(m.content)))
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  // Retrieval and answering happen in one loop. The endpoint rejects
  // `response_format` alongside `tools`, so the JSON contract is carried by
  // the prompt and enforced afterwards by the schema (with a repair round if
  // the model wraps it in prose).
  const loop = await runToolLoop({
    ctx: input.ctx,
    userId: input.userId,
    messages: [
      { role: "system", content: systemPrompt },
      // Kept as a separate turn rather than spliced into the system prompt,
      // which stays byte-identical across turns so the provider can cache it.
      ...(input.conversationSummary
        ? [
            {
              role: "system" as const,
              content: `Earlier in this conversation:
${input.conversationSummary}`,
            },
          ]
        : []),
      ...historyMessages,
      // After the history, not before it. A thread that ran in Bulgarian
      // for ten turns and then gets an English message is the case that
      // kept failing: whatever the system prompt says about mirroring the
      // user is thousands of tokens back, while ten Bulgarian turns sit
      // right next to the message being answered. This is the last thing
      // the model reads before that message.
      ...replyLanguageMessages({
        locale: input.contextPack.locale,
        message: input.message,
      }),
      { role: "user", content: input.message },
    ],
    tools: toolDefinitionsFor(a1WorkspaceConciergeProfile.draftToolAllowlist),
    registry: input.registry ?? A1_READ_TOOLS,
    temperature: 0.2,
    purpose: "a1.draft",
    signal: input.signal,
    onToolCall: input.onToolCall,
    onAnswerDelta: input.onAnswerDelta,
  });

  if (loop.exhausted) return { loop, parsed: null };

  const parsed = await parseAndValidate(loop.content, A1OutputSchema, {
    userId: input.userId,
    signal: input.signal,
  });
  return { loop, parsed };
}

export const a1Concierge = {
  async draft(input: AgentDraftInput): Promise<AgentDraftResult> {
    // A1 is the only agent this entry point serves. It used to also accept
    // `agentId: "task_planner"` and run a second, divergent copy of A2 —
    // unreachable, because the router's input is `z.literal("workspace_concierge")`,
    // and a standing invitation for the two copies to drift apart.
    if (input.agentId !== "workspace_concierge") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unknown agentId: ${input.agentId}. Task, note and event plans go through their own draft procedures.`,
      });
    }

    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();
    const contextPack = await buildA1Context(input.ctx, input.scope);

    let outputJson: A1Output;
    try {
      const { loop: loopResult, parsed: parseResult } = await runA1Turn({
        ctx: input.ctx,
        userId,
        contextPack,
        message: input.message,
        conversationHistory: input.conversationHistory,
        conversationSummary: input.conversationSummary,
        signal: input.signal,
        onToolCall: input.onToolCall,
        onAnswerDelta: input.onAnswerDelta,
      });

      if (parseResult === null) {
        log.warn("A1 could not finish within its tool budget", {
          toolCalls: loopResult.toolCallsMade.length,
        });
        return {
          draftId,
          outputJson: buildFallbackResponse(input, contextPack.locale),
        };
      }

      if (parseResult.success) {
        outputJson = parseResult.data;
      } else {
        const safeScope = input.scope ?? {};
        const isBg =
          contextPack.locale === "bg" ||
          (typeof input.message === "string" && /[Ѐ-ӿ]/.test(input.message));
        outputJson = {
          intent: {
            type: "answer" as const,
            scope: { orgId: safeScope.orgId, projectId: safeScope.projectId },
          },
          answer: {
            summary: isBg
              ? "Възникна грешка при обработката на вашата заявка. Моля, опитайте да преформулирате."
              : "I encountered an error processing your request. Please try rephrasing.",
            details: [parseResult.error],
          },
          handoff: undefined,
          handoffs: [],
        };
      }
    } catch (err) {
      log.error("LLM call failed", { agentId: input.agentId, err });
      outputJson = buildFallbackResponse(
        input,
        contextPack?.locale ?? undefined,
      );
    }

    return { draftId, outputJson };
  },
};

export { a1WorkspaceConciergeProfile };
