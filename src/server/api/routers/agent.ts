import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { agentOrchestrator } from "~/server/llm/orchestrator/agentOrchestrator";
import { runAgentTurn } from "~/server/llm/orchestrator/handoff";
import {
  findLatestConversation,
  loadConversation,
} from "~/server/llm/conversations";
import {
  GenerateTaskDraftsInputSchema,
  ExtractTasksFromPdfInputSchema,
} from "~/server/llm/schemas/taskGenerationSchemas";
import {
  TaskPlannerDraftInputSchema,
  TaskPlannerConfirmInputSchema,
  TaskPlannerApplyInputSchema,
} from "~/server/llm/schemas/a2TaskPlannerSchemas";
import {
  NotesVaultDraftInputSchema,
  NotesVaultConfirmInputSchema,
  NotesVaultApplyInputSchema,
} from "~/server/llm/schemas/a3NotesVaultSchemas";
import {
  EventsPublisherDraftInputSchema,
  EventsPublisherConfirmInputSchema,
  EventsPublisherApplyInputSchema,
} from "~/server/llm/schemas/a4EventsPublisherSchemas";
import { consumeRateLimit, checkRateLimit } from "~/server/security/rateLimit";

/**
 * Rate-limited protected procedure — consumes one AI request from the user's
 * daily quota. Used for all LLM-calling mutations (drafts, generation, extraction).
 * Confirm/Apply procedures are NOT rate-limited since they don't call the LLM.
 */
const rateLimitedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await consumeRateLimit(ctx.session.user.id);
  return next();
});

export const agentRouter = createTRPCRouter({

  /**
   * Check the caller's remaining AI request quota.
   */
  rateLimitStatus: protectedProcedure.query(async ({ ctx }) => {
    return checkRateLimit(ctx.session.user.id);
  }),
  /**
   * General A1 draft — workspace concierge answers questions with LLM.
   */
  draft: rateLimitedProcedure
    .input(
      z.object({
        agentId: z.literal("workspace_concierge"),
        message: z.string().min(1).max(20_000),
        scope: z
          .object({
            orgId: z.union([z.string(), z.number()]).optional(),
            projectId: z.union([z.string(), z.number()]).optional(),
          })
          .optional(),
        conversationHistory: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            }),
          )
          .max(16)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.draft({
        ctx,
        agentId: input.agentId,
        message: input.message,
        scope: input.scope,
        conversationHistory: input.conversationHistory,
      });
    }),

  /**
   * A1 Project Chatbot — can run either project-scoped or workspace-scoped.
   * Used by the Project Intelligence UI with a project picker.
   *
   * Non-streaming sibling of `POST /api/ai/chat`. Both run the same
   * {@link runAgentTurn}, so a handoff is executed server-side and the caller
   * gets one result; the route exists only to report progress while it happens.
   */
  projectChatbot: rateLimitedProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        message: z.string().min(1).max(20_000),
        conversationHistory: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            }),
          )
          .max(16)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return runAgentTurn({
        ctx,
        message: input.message,
        scope: input.projectId ? { projectId: input.projectId } : undefined,
        conversationHistory: input.conversationHistory,
      });
    }),

  /**
   * Rehydrate a stored conversation after a reload.
   */
  conversation: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return loadConversation(ctx, input.conversationId, ctx.session.user.id);
    }),

  /** The caller's most recent conversation for this scope, if there is one. */
  latestConversation: protectedProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const conversationId = await findLatestConversation(
        ctx,
        ctx.session.user.id,
        input.projectId ?? null,
      );
      if (!conversationId) return { conversationId: null, messages: [] };
      return {
        conversationId,
        messages: await loadConversation(ctx, conversationId, ctx.session.user.id),
      };
    }),

  // -------------------------------------------------------------------------
  // A2 Task Planner
  // -------------------------------------------------------------------------

  taskPlannerDraft: rateLimitedProcedure
    .input(TaskPlannerDraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.taskPlannerDraft({
        ctx,
        message: input.message,
        scope: input.scope,
        handoffContext: input.handoffContext,
      });
    }),

  taskPlannerConfirm: protectedProcedure
    .input(TaskPlannerConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.taskPlannerConfirm({
        ctx,
        draftId: input.draftId,
      });
    }),

  taskPlannerApply: protectedProcedure
    .input(TaskPlannerApplyInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.taskPlannerApply({
        ctx,
        draftId: input.draftId,
        confirmationToken: input.confirmationToken,
      });
    }),

  // -------------------------------------------------------------------------
  // A3 Notes Vault
  // -------------------------------------------------------------------------

  notesVaultDraft: rateLimitedProcedure
    .input(NotesVaultDraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.notesVaultDraft({
        ctx,
        message: input.message,
        handoffContext: input.handoffContext,
      });
    }),

  notesVaultConfirm: protectedProcedure
    .input(NotesVaultConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.notesVaultConfirm({
        ctx,
        draftId: input.draftId,
        edits: input.edits,
      });
    }),

  notesVaultApply: protectedProcedure
    .input(NotesVaultApplyInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.notesVaultApply({
        ctx,
        draftId: input.draftId,
        confirmationToken: input.confirmationToken,
        handoffContext: input.handoffContext,
      });
    }),

  /**
   * Generate task drafts from a project's description.
   * The agent analyzes the project description and existing tasks
   * to produce intelligent, non-duplicate task suggestions.
   */
  generateTaskDrafts: rateLimitedProcedure
    .input(GenerateTaskDraftsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.generateTaskDrafts({
        ctx,
        projectId: input.projectId,
        message: input.message,
      });
    }),

  /**
   * Extract tasks from an uploaded PDF document.
   * Supports documents in EN, BG, ES, DE, FR.
   */
  extractTasksFromPdf: rateLimitedProcedure
    .input(ExtractTasksFromPdfInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.extractTasksFromPdf({
        ctx,
        projectId: input.projectId,
        pdfBase64: input.pdfBase64,
        fileName: input.fileName,
        message: input.message,
      });
    }),

  // -------------------------------------------------------------------------
  // A4 Events Publisher
  // -------------------------------------------------------------------------

  eventsPublisherDraft: rateLimitedProcedure
    .input(EventsPublisherDraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.eventsPublisherDraft({
        ctx,
        message: input.message,
        handoffContext: input.handoffContext,
      });
    }),

  eventsPublisherConfirm: protectedProcedure
    .input(EventsPublisherConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.eventsPublisherConfirm({
        ctx,
        draftId: input.draftId,
        edits: input.edits,
      });
    }),

  eventsPublisherApply: protectedProcedure
    .input(EventsPublisherApplyInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.eventsPublisherApply({
        ctx,
        draftId: input.draftId,
        confirmationToken: input.confirmationToken,
      });
    }),
});
