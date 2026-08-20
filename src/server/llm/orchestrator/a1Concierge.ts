/**
 * A1 — Workspace Concierge: answers questions about the caller's workspace.
 */

import {
  TRPCError,
} from "@trpc/server";
import {
} from "drizzle-orm";

import {
  assertProjectPermission,
} from "~/server/api/authz";
import {
  a1WorkspaceConciergeProfile,
} from "~/server/llm/profiles/a1WorkspaceConcierge";
import {
  a2TaskPlannerProfile,
} from "~/server/llm/profiles/a2TaskPlanner";
import {
  A1OutputSchema,
  type A1Output,
} from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import {
  TaskPlanDraftSchema,
  type TaskPlanDraft,
} from "~/server/llm/schemas/a2TaskPlannerSchemas";
import {
  buildA1Context,
} from "~/server/llm/context/a1ContextBuilder";
import {
  buildA2Context,
} from "~/server/llm/context/a2ContextBuilder";

import {
  getA1SystemPrompt,
} from "~/server/llm/prompts/a1Prompts";
import {
  getA2SystemPrompt,
} from "~/server/llm/prompts/a2Prompts";

import {
  chatCompletion,
} from "~/server/llm/core/modelClient";
import {
  parseAndValidate,
} from "~/server/llm/core/jsonRepair";

import {
  agentTaskPlannerDrafts,
} from "~/server/db/schema";
import {
  createDraftId,
  requireUserId,
  requireProjectId,
  computePlanHash,
  type AgentDraftInput,
  type AgentDraftResult,
  log,
} from "./shared";
/**
 * What A1 answers with when the model is unavailable.
 *
 * Used only by the concierge, so it lives with it.
 */
async function buildFallbackResponse(
  context: Awaited<ReturnType<typeof buildA1Context>>,
  input: AgentDraftInput,
): Promise<A1Output> {
  // Privacy + UX: do NOT dump workspace/project lists unless explicitly asked.
  // Fallback should be a neutral "I'm unavailable" response that still guides the user.
  void context;

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
    const profile =
      input.agentId === "workspace_concierge"
        ? a1WorkspaceConciergeProfile
        : input.agentId === "task_planner"
          ? a2TaskPlannerProfile
          : null;

    if (!profile) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unknown agentId: ${input.agentId}`,
      });
    }

    const draftId = createDraftId();

    // 1. Build context pack
    const contextPack =
      input.agentId === "workspace_concierge"
        ? await buildA1Context(input.ctx, input.scope)
        : await buildA2Context({
            ctx: input.ctx,
            scope: {
              orgId: input.scope?.orgId,
              projectId:
                typeof input.scope?.projectId === "number"
                  ? input.scope.projectId
                  : undefined,
            },
          });

    // 2. Build system prompt
    const systemPrompt =
      input.agentId === "workspace_concierge"
        ? getA1SystemPrompt(contextPack as Parameters<typeof getA1SystemPrompt>[0])
        : getA2SystemPrompt(contextPack as Parameters<typeof getA2SystemPrompt>[0]);

    // 3. Call LLM
    let outputJson: A1Output | TaskPlanDraft;
    try {
      // Build messages: system → conversation history → current user message
      const historyMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
        (input.conversationHistory ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const llmResponse = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: input.message },
        ],
        temperature: 0.2,
        jsonMode: true,
      });

      if (input.agentId === "workspace_concierge") {
        // 4a. Parse + validate with repair loop (A1)
        const parseResult = await parseAndValidate(llmResponse.content, A1OutputSchema);

        if (!parseResult.success) {
          const safeScope = input.scope ?? {};
          outputJson = {
            intent: {
              type: "answer" as const,
              scope: { orgId: safeScope.orgId, projectId: safeScope.projectId },
            },
            answer: {
              summary: "I encountered an error processing your request. Please try rephrasing.",
              details: [parseResult.error],
            },
          };
        } else {
          outputJson = parseResult.data;
        }
      } else {
        // 4b. Parse + validate with repair loop (A2)
        const parseResult = await parseAndValidate(llmResponse.content, TaskPlanDraftSchema);

        if (!parseResult.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid A2 plan JSON: ${parseResult.error}`,
          });
        }

        const userId = requireUserId(input.ctx);
        const projectId = requireProjectId(input.scope);

        // Caller-supplied scope — authorize before persisting a draft against it.
        await assertProjectPermission(input.ctx, projectId, "canAssignTasks");

        const computedPlanHash = computePlanHash(parseResult.data);
        const plan: TaskPlanDraft = {
          ...parseResult.data,
          planHash: computedPlanHash,
        };

        await input.ctx.db.insert(agentTaskPlannerDrafts).values({
          id: draftId,
          userId,
          projectId,
          message: input.message,
          planJson: JSON.stringify(plan),
          planHash: computedPlanHash,
          status: "draft",
        });

        outputJson = plan;
      }
    } catch (err) {
      // LLM call failed — log the real error, then return a safe fallback
      log.error("LLM call failed", { agentId: input.agentId, err });
      if (input.agentId === "workspace_concierge") {
        const contextFallback = await buildFallbackResponse(
          contextPack as Parameters<typeof buildFallbackResponse>[0],
          input,
        );
        outputJson = contextFallback;
      } else {
        throw err instanceof TRPCError
          ? err
          : new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                err instanceof Error
                  ? `Agent error: ${err.message}`
                  : "An unexpected error occurred while processing your request",
            });
      }
    }

    return { draftId, outputJson };
  },

  /**
   * Generate task drafts from a project description using the LLM.
   * This is the "description-aware" feature — the agent analyzes the project
   * description to produce intelligent task suggestions.
   */
};
