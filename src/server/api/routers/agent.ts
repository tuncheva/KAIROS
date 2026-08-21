import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { agentOrchestrator } from "~/server/llm/orchestrator/agentOrchestrator";
import { runAgentTurn } from "~/server/llm/orchestrator/handoff";
import {
  deleteConversation,
  findLatestConversation,
  listConversations,
  loadConversation,
} from "~/server/llm/conversations";
import {
  OrgAdminApplyInputSchema,
  OrgAdminConfirmInputSchema,
  OrgAdminDraftInputSchema,
} from "~/server/llm/schemas/a5OrgAdminSchemas";
import { clearMemory, deleteFact, loadUserMemory } from "~/server/llm/memory";
import { getAiMetrics } from "~/server/llm/observability";
import {
  undoAvailability,
  undoNoteApply,
  undoTaskApply,
} from "~/server/llm/undo";
import {
  dismissFinding,
  findingStats,
  listOpenFindings,
  suggestedFixFor,
  type FindingKind,
} from "~/server/llm/scheduled/riskRadar";
import { runBriefNow } from "~/server/llm/scheduled/runner";
import { aiSchedules } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
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
import {
  checkRateLimit,
  checkSystemRateLimit,
  consumeRateLimit,
} from "~/server/security/rateLimit";

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
        priorDraftId: input.priorDraftId,
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

  // -------------------------------------------------------------------------
  // A5 Org Admin (E-4)
  // -------------------------------------------------------------------------

  orgAdminDraft: rateLimitedProcedure
    .input(OrgAdminDraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.orgAdminDraft({
        ctx,
        message: input.message,
        organizationId: input.organizationId,
      });
    }),

  orgAdminConfirm: protectedProcedure
    .input(OrgAdminConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.orgAdminConfirm({ ctx, draftId: input.draftId });
    }),

  orgAdminApply: protectedProcedure
    .input(OrgAdminApplyInputSchema)
    .mutation(async ({ ctx, input }) => {
      return agentOrchestrator.orgAdminApply({
        ctx,
        draftId: input.draftId,
        confirmationToken: input.confirmationToken,
      });
    }),

  // -------------------------------------------------------------------------
  // C-2 Assistant memory
  // -------------------------------------------------------------------------

  /** Everything the assistant is remembering, for Settings → AI Memory. */
  memory: protectedProcedure.query(async ({ ctx }) => {
    return loadUserMemory(ctx, ctx.session.user.id);
  }),

  forgetMemory: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await deleteFact(ctx, ctx.session.user.id, input.id);
      return { forgotten: true };
    }),

  clearMemory: protectedProcedure.mutation(async ({ ctx }) => {
    await clearMemory(ctx, ctx.session.user.id);
    return { cleared: true };
  }),

  // -------------------------------------------------------------------------
  // C-3 Conversation history
  // -------------------------------------------------------------------------

  conversations: protectedProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(50).optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return listConversations(ctx, ctx.session.user.id, input?.limit ?? 30);
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await deleteConversation(ctx, input.conversationId, ctx.session.user.id);
      return { deleted: true };
    }),

  // -------------------------------------------------------------------------
  // B-2 / B-3 Risk radar findings
  // -------------------------------------------------------------------------

  findings: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listOpenFindings(ctx, ctx.session.user.id);
    // The suggested fix is derived rather than stored: it is a function of the
    // finding kind, so storing it would mean a migration every time the wording
    // improves.
    return rows.map((row) => ({
      ...row,
      suggestedFix: suggestedFixFor({
        kind: row.kind as FindingKind,
        severity: "info",
        projectId: row.projectId,
        title: row.title,
        detail: row.detail,
        fingerprint: row.fingerprint,
        taskIds: [],
      }),
    }));
  }),

  dismissFinding: protectedProcedure
    .input(z.object({ findingId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await dismissFinding(ctx, ctx.session.user.id, input.findingId);
      return { dismissed: true };
    }),

  /**
   * Dismissal rate is the metric that decides whether proactive AI stays on.
   * Surfaced in the product rather than buried in a log.
   */
  findingStats: protectedProcedure.query(async ({ ctx }) => {
    return findingStats(ctx, ctx.session.user.id);
  }),

  // -------------------------------------------------------------------------
  // B-4 Proactive schedules
  // -------------------------------------------------------------------------

  schedules: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(aiSchedules)
      .where(eq(aiSchedules.userId, ctx.session.user.id));

    // A missing row means off. Returned explicitly so the settings UI does not
    // have to encode "absent means disabled" itself.
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return (["daily_brief", "risk_radar"] as const).map((kind) => {
      const row = byKind.get(kind);
      return {
        kind,
        enabled: row?.enabled ?? false,
        hourUtc: row?.hourUtc ?? 7,
        lastRunAt: row?.lastRunAt ?? null,
        lastError: row?.lastError ?? null,
      };
    });
  }),

  setSchedule: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["daily_brief", "risk_radar"]),
        enabled: z.boolean(),
        hourUtc: z.number().int().min(0).max(23).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [existing] = await ctx.db
        .select({ id: aiSchedules.id })
        .from(aiSchedules)
        .where(
          and(eq(aiSchedules.userId, userId), eq(aiSchedules.kind, input.kind)),
        )
        .limit(1);

      if (existing) {
        await ctx.db
          .update(aiSchedules)
          .set({
            enabled: input.enabled,
            ...(input.hourUtc !== undefined ? { hourUtc: input.hourUtc } : {}),
            updatedAt: new Date(),
          })
          .where(eq(aiSchedules.id, existing.id));
      } else {
        await ctx.db.insert(aiSchedules).values({
          userId,
          kind: input.kind,
          enabled: input.enabled,
          hourUtc: input.hourUtc ?? 7,
        });
      }

      return { ok: true };
    }),

  /** "Show me what a brief looks like" — costs one system-budget request. */
  previewBrief: protectedProcedure.mutation(async ({ ctx }) => {
    const sent = await runBriefNow(ctx.session.user.id);
    return {
      sent: sent > 0,
      message:
        sent > 0
          ? "Sent — check your notifications."
          : "Nothing needs your attention right now, so there is no brief to send.",
    };
  }),

  // -------------------------------------------------------------------------
  // G-5 Undo
  // -------------------------------------------------------------------------

  undoAvailability: protectedProcedure
    .input(z.object({ draftId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return undoAvailability(ctx, ctx.session.user.id, input.draftId);
    }),

  undoApply: protectedProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        kind: z.enum(["tasks", "notes"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return input.kind === "tasks"
        ? undoTaskApply(ctx, ctx.session.user.id, input.draftId)
        : undoNoteApply(ctx, ctx.session.user.id, input.draftId);
    }),

  // -------------------------------------------------------------------------
  // F-3 Observability
  // -------------------------------------------------------------------------

  metrics: protectedProcedure
    .input(
      z.object({ days: z.number().int().min(1).max(90).optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const [metrics, interactive, system] = await Promise.all([
        getAiMetrics(ctx, ctx.session.user.id, input?.days ?? 30),
        checkRateLimit(ctx.session.user.id),
        checkSystemRateLimit(ctx.session.user.id),
      ]);
      return { ...metrics, quota: { interactive, system } };
    }),
});
