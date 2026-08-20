/**
 * A1 — Workspace Concierge: answers questions about the caller's workspace.
 *
 * Read-only. When the user wants something written, A1 emits a handoff and the
 * matching sub-agent (A2/A3/A4) owns the draft → confirm → apply lifecycle.
 */

import { TRPCError } from "@trpc/server";

import { a1WorkspaceConciergeProfile } from "~/server/llm/profiles/a1WorkspaceConcierge";
import {
  A1OutputSchema,
  type A1Output,
} from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import { buildA1Context } from "~/server/llm/context/a1ContextBuilder";
import { getA1SystemPrompt } from "~/server/llm/prompts/a1Prompts";
import { parseAndValidate } from "~/server/llm/core/jsonRepair";
import { runToolLoop } from "~/server/llm/core/toolLoop";
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
function buildFallbackResponse(input: AgentDraftInput): A1Output {
  const safeScope = input.scope ?? {};
  return {
    intent: {
      type: "answer" as const,
      scope: { orgId: safeScope.orgId, projectId: safeScope.projectId },
    },
    answer: {
      summary:
        "I’m having trouble generating an AI response right now. Try rephrasing your question or be more specific about what you need.",
      details: [
        "• Ask a direct question (e.g., ‘What’s the status of Project X?’)",
        "• If you want tasks created, say ‘create tasks for …’ and I’ll hand it off to the Task Planner",
      ],
    },
    citations: [{ label: "fallback", ref: "ai_unavailable" }],
  };
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
    const systemPrompt = getA1SystemPrompt(contextPack);

    let outputJson: A1Output;
    try {
      const historyMessages = (input.conversationHistory ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Retrieval and answering happen in one loop. The endpoint rejects
      // `response_format` alongside `tools`, so the JSON contract is carried by
      // the prompt and enforced afterwards by the schema (with a repair round if
      // the model wraps it in prose).
      const loopResult = await runToolLoop({
        ctx: input.ctx,
        userId,
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: input.message },
        ],
        tools: toolDefinitionsFor(
          a1WorkspaceConciergeProfile.draftToolAllowlist,
        ),
        registry: A1_READ_TOOLS,
        temperature: 0.2,
        purpose: "a1.draft",
        signal: input.signal,
        onToolCall: input.onToolCall,
      });

      if (loopResult.exhausted) {
        log.warn("A1 could not finish within its tool budget", {
          toolCalls: loopResult.toolCallsMade.length,
        });
        return { draftId, outputJson: buildFallbackResponse(input) };
      }

      const parseResult = await parseAndValidate(
        loopResult.content,
        A1OutputSchema,
        { userId, signal: input.signal },
      );

      if (parseResult.success) {
        outputJson = parseResult.data;
      } else {
        const safeScope = input.scope ?? {};
        outputJson = {
          intent: {
            type: "answer" as const,
            scope: { orgId: safeScope.orgId, projectId: safeScope.projectId },
          },
          answer: {
            summary:
              "I encountered an error processing your request. Please try rephrasing.",
            details: [parseResult.error],
          },
        };
      }
    } catch (err) {
      log.error("LLM call failed", { agentId: input.agentId, err });
      outputJson = buildFallbackResponse(input);
    }

    return { draftId, outputJson };
  },
};

export { a1WorkspaceConciergeProfile };
