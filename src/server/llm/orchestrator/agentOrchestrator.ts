import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { eq, desc, and } from "drizzle-orm";

import { env } from "~/env";
import type { TRPCContext } from "~/server/api/trpc";
import { assertProjectAccess, assertProjectPermission } from "~/server/api/authz";
import { a1WorkspaceConciergeProfile } from "~/server/llm/profiles/a1WorkspaceConcierge";
import { a2TaskPlannerProfile } from "~/server/llm/profiles/a2TaskPlanner";
import {
  A1OutputSchema,
  type A1Output,
} from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import {
  TaskGenerationOutputSchema,
  type GenerateTaskDraftsOutput,
} from "~/server/llm/schemas/taskGenerationSchemas";
import {
  TaskPlanDraftSchema,
  type TaskPlanDraft,
} from "~/server/llm/schemas/a2TaskPlannerSchemas";
import {
  NotesVaultDraftSchema,
  type NotesVaultDraft,
  type NotesVaultApplyOutput,
} from "~/server/llm/schemas/a3NotesVaultSchemas";
import {
  EventsPublisherDraftSchema,
  type EventsPublisherDraft,
  type EventsPublisherApplyOutput,
} from "~/server/llm/schemas/a4EventsPublisherSchemas";
import { buildA1Context } from "~/server/llm/context/a1ContextBuilder";
import { buildA2Context } from "~/server/llm/context/a2ContextBuilder";
import { buildA3Context } from "~/server/llm/context/a3ContextBuilder";
import { buildA4Context } from "~/server/llm/context/a4ContextBuilder";
import {
  getA1SystemPrompt,
  getTaskGenerationPrompt,
  getPdfTaskExtractionPrompt,
} from "~/server/llm/prompts/a1Prompts";
import { getA2SystemPrompt } from "~/server/llm/prompts/a2Prompts";
import { getA3SystemPrompt } from "~/server/llm/prompts/a3Prompts";
import { getA4SystemPrompt } from "~/server/llm/prompts/a4Prompts";
import { chatCompletion } from "~/server/llm/llm/modelClient";
import { parseAndValidate } from "~/server/llm/llm/jsonRepair";
import { extractTextFromPdf } from "~/server/llm/pdf/pdfExtractor";
import {
  projects,
  tasks,
  taskActivityLog,
  projectCollaborators,
  users,
  stickyNotes,
  agentNotesVaultDrafts,
  agentNotesVaultApplies,
  agentTaskPlannerDrafts,
  agentTaskPlannerApplies,
  events as eventsTable,
  eventComments,
  eventLikes,
  eventRsvps,
} from "~/server/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentId = "workspace_concierge" | "task_planner" | "notes_vault" | "events_publisher";

export interface AgentDraftInput {
  ctx: TRPCContext;
  agentId: AgentId;
  message: string;
  scope?: {
    orgId?: string | number;
    projectId?: string | number;
  };
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AgentDraftResult {
  draftId: string;
  outputJson: A1Output | TaskPlanDraft | NotesVaultDraft;
}

export interface TaskDraftInput {
  ctx: TRPCContext;
  projectId: number;
  message?: string;
}

export interface PdfTaskInput {
  ctx: TRPCContext;
  projectId: number;
  pdfBase64: string;
  fileName?: string;
  message?: string;
}

function createDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function requireUserId(ctx: TRPCContext): string {
  const userId = ctx.session?.user?.id;
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

function requireProjectId(scope?: { projectId?: string | number }): number {
  const pid = scope?.projectId;
  if (typeof pid === "number") return pid;
  throw new TRPCError({ code: "BAD_REQUEST", message: "projectId is required" });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function computePlanHash(plan: unknown): string {
  return crypto.createHash("sha256").update(stableJson(plan)).digest("hex");
}

type ConfirmationTokenPayload = {
  userId: string;
  draftId: string;
  planHash: string;
  expiresAt: number;
};

function mintConfirmationToken(payload: ConfirmationTokenPayload): string {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AUTH_SECRET is not configured" });
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function readConfirmationToken(token: string): ConfirmationTokenPayload {
  try {
    const secret = env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not configured");

    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) throw new Error("Malformed token");

    const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
    if (expected.length !== sig.length) throw new Error("Signature mismatch");

    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expected, "base64url");
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) throw new Error("Signature mismatch");

    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    return JSON.parse(raw) as ConfirmationTokenPayload;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid confirmation token" });
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export const agentOrchestrator = {
  // ---------------------------------------------------------------------------
  // A3 Notes Vault API
  // ---------------------------------------------------------------------------

  async notesVaultDraft(input: {
    ctx: TRPCContext;
    message: string;
    handoffContext?: Record<string, unknown>;
  }): Promise<{ draftId: string; plan: NotesVaultDraft }> {
    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();

    const contextPack = await buildA3Context({
      ctx: input.ctx,
      handoffContext: input.handoffContext,
    });

    const systemPrompt = getA3SystemPrompt(contextPack);

    const llmResponse = await chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.message },
      ],
      temperature: 0.2,
      jsonMode: true,
    });

    const parseResult = await parseAndValidate(llmResponse.content, NotesVaultDraftSchema);
    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A3 plan JSON: ${parseResult.error}`,
      });
    }

    // Server-side guardrails: enforce requiresUnlocked for password-protected notes.
    const lockedIds = new Set(
      contextPack.notes.filter((n) => n.isLocked).map((n) => n.id),
    );

    const guardedPlan: NotesVaultDraft = {
      ...parseResult.data,
      operations: parseResult.data.operations.map((op) => {
        if (op.type !== "update") return op;
        const requiresUnlocked = lockedIds.has(op.noteId) ? true : op.requiresUnlocked;
        return { ...op, requiresUnlocked };
      }),
    };

    const planHash = computePlanHash(guardedPlan);
    const plan: NotesVaultDraft = { ...guardedPlan, planHash };

    await input.ctx.db.insert(agentNotesVaultDrafts).values({
      id: draftId,
      userId,
      message: input.message,
      planJson: JSON.stringify(plan),
      planHash,
      status: "draft",
    });

    return { draftId, plan };
  },

  async notesVaultConfirm(input: {
    ctx: TRPCContext;
    draftId: string;
    edits?: Array<{ index: number; content: string }>;
  }): Promise<{ confirmationToken: string; summary: { creates: number; updates: number; deletes: number; blocked: number } }> {
    const userId = requireUserId(input.ctx);

    const [draft] = await input.ctx.db
      .select({
        id: agentNotesVaultDrafts.id,
        userId: agentNotesVaultDrafts.userId,
        planJson: agentNotesVaultDrafts.planJson,
        planHash: agentNotesVaultDrafts.planHash,
        status: agentNotesVaultDrafts.status,
        confirmationToken: agentNotesVaultDrafts.confirmationToken,
      })
      .from(agentNotesVaultDrafts)
      .where(eq(agentNotesVaultDrafts.id, input.draftId))
      .limit(1);

    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
    if (draft.status === "confirmed") {
      // Idempotent confirm: allow the UI to recover if the user clicks Confirm twice.
      return {
        confirmationToken: draft.confirmationToken ?? mintConfirmationToken({
          userId,
          draftId: draft.id,
          planHash: draft.planHash,
          expiresAt: Date.now() + 10 * 60 * 1000,
        }),
        summary: {
          creates: 0,
          updates: 0,
          deletes: 0,
          blocked: 0,
        },
      };
    }

    if (draft.status !== "draft") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Draft is not confirmable (status=${draft.status})`,
      });
    }

    let plan = NotesVaultDraftSchema.parse(JSON.parse(draft.planJson) as unknown);

    // Apply user edits if provided
    if (input.edits && input.edits.length > 0) {
      const updatedOperations = [...plan.operations];
      for (const edit of input.edits) {
        if (edit.index >= 0 && edit.index < updatedOperations.length) {
          const op = updatedOperations[edit.index];
          if (op?.type === "create") {
            updatedOperations[edit.index] = { ...op, content: edit.content };
          } else if (op?.type === "update") {
            updatedOperations[edit.index] = { ...op, nextContent: edit.content };
          }
          // Don't allow editing delete operations
        }
      }
      plan = { ...plan, operations: updatedOperations };
      
      // Recompute plan hash for edited plan
      const newPlanHash = crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
      
      // Update the stored draft with edited plan
      await input.ctx.db
        .update(agentNotesVaultDrafts)
        .set({
          planJson: JSON.stringify(plan),
          planHash: newPlanHash,
          updatedAt: new Date(),
        })
        .where(eq(agentNotesVaultDrafts.id, draft.id));
    }

    const confirmationToken =
      draft.confirmationToken ??
      mintConfirmationToken({
        userId,
        draftId: draft.id,
        planHash: draft.planHash,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

    await input.ctx.db
      .update(agentNotesVaultDrafts)
      .set({
        status: "confirmed",
        confirmationToken,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentNotesVaultDrafts.id, draft.id));

    const creates = plan.operations.filter((o) => o.type === "create").length;
    const updates = plan.operations.filter((o) => o.type === "update").length;
    const deletes = plan.operations.filter((o) => o.type === "delete").length;

    return {
      confirmationToken,
      summary: {
        creates,
        updates,
        deletes,
        blocked: plan.blocked.length,
      },
    };
  },

  async notesVaultApply(input: {
    ctx: TRPCContext;
    draftId: string;
    confirmationToken: string;
    handoffContext?: Record<string, unknown>;
  }): Promise<NotesVaultApplyOutput> {
    const userId = requireUserId(input.ctx);

    const payload = readConfirmationToken(input.confirmationToken);
    if (payload.userId !== userId || payload.draftId !== input.draftId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Confirmation token does not match user/draft" });
    }
    if (Date.now() > payload.expiresAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token expired" });
    }

    const [draft] = await input.ctx.db
      .select({
        id: agentNotesVaultDrafts.id,
        userId: agentNotesVaultDrafts.userId,
        planJson: agentNotesVaultDrafts.planJson,
        planHash: agentNotesVaultDrafts.planHash,
        status: agentNotesVaultDrafts.status,
        confirmationToken: agentNotesVaultDrafts.confirmationToken,
      })
      .from(agentNotesVaultDrafts)
      .where(eq(agentNotesVaultDrafts.id, input.draftId))
      .limit(1);

    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
    if (draft.status !== "confirmed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Draft is not applicable (status=${draft.status})` });
    }
    if (draft.planHash !== payload.planHash) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Plan hash mismatch" });
    }
    if (draft.confirmationToken !== input.confirmationToken) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token mismatch" });
    }

    const plan = NotesVaultDraftSchema.parse(JSON.parse(draft.planJson) as unknown);

    // Apply-time guard: only allow locked-note updates/deletes if the plaintext is present in handoffContext.
    const contextPack = await buildA3Context({ ctx: input.ctx, handoffContext: input.handoffContext });
    const unlockedIds = new Set(
      contextPack.notes.filter((n) => n.isLocked && n.unlockedContent).map((n) => n.id),
    );

    const lockedIds = new Set(contextPack.notes.filter((n) => n.isLocked).map((n) => n.id));

    const createdNoteIds: number[] = [];
    const updatedNoteIds: number[] = [];
    const deletedNoteIds: number[] = [];
    const blockedNoteIds: number[] = [];

    for (const op of plan.operations) {
      if (op.type === "create") {
        const inserted = await input.ctx.db
          .insert(stickyNotes)
          .values({
            content: op.content,
            createdById: userId,
            shareStatus: "private",
          })
          .returning({ id: stickyNotes.id });
        if (inserted[0]?.id) createdNoteIds.push(inserted[0].id);
        continue;
      }

      if (op.type === "update") {
        if (op.requiresUnlocked && !unlockedIds.has(op.noteId)) {
          blockedNoteIds.push(op.noteId);
          continue;
        }

        await input.ctx.db
          .update(stickyNotes)
          .set({ content: op.nextContent })
          .where(and(eq(stickyNotes.id, op.noteId), eq(stickyNotes.createdById, userId)));
        updatedNoteIds.push(op.noteId);
        continue;
      }

      if (op.type === "delete") {
        if (!op.dangerous) {
          blockedNoteIds.push(op.noteId);
          continue;
        }

        // Require unlocked handoff content for locked note deletes.
        if (lockedIds.has(op.noteId) && !unlockedIds.has(op.noteId)) {
          blockedNoteIds.push(op.noteId);
          continue;
        }

        await input.ctx.db
          .delete(stickyNotes)
          .where(and(eq(stickyNotes.id, op.noteId), eq(stickyNotes.createdById, userId)));
        deletedNoteIds.push(op.noteId);
      }
    }

    await input.ctx.db
      .insert(agentNotesVaultApplies)
      .values({
        draftId: draft.id,
        userId,
        planHash: draft.planHash,
        resultJson: JSON.stringify({ createdNoteIds, updatedNoteIds, deletedNoteIds, blockedNoteIds }),
      });

    await input.ctx.db
      .update(agentNotesVaultDrafts)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentNotesVaultDrafts.id, draft.id));

    return {
      applied: true as const,
      results: { createdNoteIds, updatedNoteIds, deletedNoteIds, blockedNoteIds },
    };
  },

  // ---------------------------------------------------------------------------
  // A2 Task Planner API
  // ---------------------------------------------------------------------------

  async taskPlannerDraft(input: {
    ctx: TRPCContext;
    message: string;
    scope?: { orgId?: string | number; projectId?: number };
    handoffContext?: Record<string, unknown>;
  }): Promise<{ draftId: string; plan: TaskPlanDraft }> {
    const userId = requireUserId(input.ctx);

    // Allow draft calls without projectId. A2 will respond with questionsForUser.
    // Try to resolve projectId from handoffContext (A1 may pass it there) or from project name.
    const hc = (input.handoffContext ?? {});
    const requestedNameRaw = hc.projectName;
    const requestedName = typeof requestedNameRaw === "string" ? requestedNameRaw.trim() : "";

    let resolvedProjectId: number | undefined = input.scope?.projectId;

    // A1 may include projectId directly in the handoff context
    if (!resolvedProjectId && typeof hc.projectId === "number") {
      resolvedProjectId = hc.projectId;
    }
    if (!resolvedProjectId && typeof hc.projectId === "string") {
      const parsed = parseInt(hc.projectId, 10);
      if (!isNaN(parsed) && parsed > 0) resolvedProjectId = parsed;
    }

    if (!resolvedProjectId && requestedName) {
      const userProjects = await input.ctx.db
        .select({ id: projects.id, title: projects.title })
        .from(projects)
        .where(eq(projects.createdById, userId));

      const norm = (s: string) => s.trim().toLowerCase();
      // Exact match first
      let matches = userProjects.filter((p) => norm(p.title) === norm(requestedName));
      // Fallback: partial/includes match (e.g. "Test" matches "Test project")
      if (matches.length === 0) {
        matches = userProjects.filter(
          (p) => norm(p.title).includes(norm(requestedName)) || norm(requestedName).includes(norm(p.title)),
        );
      }

      if (matches.length === 1) {
        resolvedProjectId = matches[0]!.id;
      } else if (matches.length > 1) {
        // Ambiguous title; let A2 ask a clarifying question.
        resolvedProjectId = undefined;
        input.handoffContext = {
          ...(input.handoffContext ?? {}),
          projectNameAmbiguous: true,
          projectNameCandidates: matches.map((m) => ({ id: m.id, title: m.title })),
        };
      } else {
        // Not found; let A2 ask for a valid project name.
        input.handoffContext = {
          ...(input.handoffContext ?? {}),
          projectNameNotFound: true,
          projectName: requestedName,
        };
      }
    }

    // `resolvedProjectId` originates from caller-supplied scope or handoff
    // context, so it must be authorized before A2 reads the project's tasks and
    // collaborators into the prompt — and before a draft is persisted against it.
    // Name-based resolution above is already constrained to the caller's own
    // projects; this covers the id-supplied paths.
    if (typeof resolvedProjectId === "number") {
      // The agent is a client of the same permission model as the UI, not a way
      // around it: drafting a task plan requires the capability to create tasks.
      await assertProjectPermission(
        input.ctx,
        resolvedProjectId,
        "canAssignTasks",
      );
    }

    const draftId = createDraftId();

    const contextPack = await buildA2Context({
      ctx: input.ctx,
      scope: { orgId: input.scope?.orgId, projectId: resolvedProjectId },
      handoffContext: input.handoffContext,
    });

    const systemPrompt = getA2SystemPrompt(contextPack);

    const llmResponse = await chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.message },
      ],
      temperature: 0.2,
      jsonMode: true,
    });

    const parseResult = await parseAndValidate(llmResponse.content, TaskPlanDraftSchema);
    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A2 plan JSON: ${parseResult.error}`,
      });
    }

    const planHash = computePlanHash(parseResult.data);
    const plan: TaskPlanDraft = { ...parseResult.data, planHash };

    // Check if the plan has actual operations that require a project
    const hasOperations =
      (plan.creates?.length ?? 0) +
      (plan.updates?.length ?? 0) +
      (plan.statusChanges?.length ?? 0) +
      (plan.deletes?.length ?? 0) > 0;

    if (typeof resolvedProjectId !== "number" && hasOperations) {
      // The LLM generated tasks but we have no project to put them in.
      // Return the plan with a questionsForUser entry so the frontend stops the pipeline.
      const planWithQuestion: TaskPlanDraft = {
        ...plan,
        creates: [],
        updates: [],
        statusChanges: [],
        deletes: [],
        questionsForUser: [
          ...(plan.questionsForUser ?? []),
          "Which project should I add these tasks to? Please specify the project name.",
        ],
      };
      return { draftId, plan: planWithQuestion };
    }

    // Persist the draft when we have a resolved projectId.
    if (typeof resolvedProjectId === "number") {
      await input.ctx.db.insert(agentTaskPlannerDrafts).values({
        id: draftId,
        userId,
        projectId: resolvedProjectId,
        message: input.message,
        planJson: JSON.stringify(plan),
        planHash,
        status: "draft",
      });
    }

    return { draftId, plan };
  },

  async taskPlannerConfirm(input: {
    ctx: TRPCContext;
    draftId: string;
  }): Promise<{ confirmationToken: string; summary: { creates: number; updates: number; statusChanges: number; deletes: number } }> {
    const userId = requireUserId(input.ctx);

    const [draft] = await input.ctx.db
      .select({
        id: agentTaskPlannerDrafts.id,
        userId: agentTaskPlannerDrafts.userId,
        planJson: agentTaskPlannerDrafts.planJson,
        planHash: agentTaskPlannerDrafts.planHash,
        status: agentTaskPlannerDrafts.status,
      })
      .from(agentTaskPlannerDrafts)
      .where(eq(agentTaskPlannerDrafts.id, input.draftId))
      .limit(1);

    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
    if (draft.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Draft is not confirmable (status=${draft.status})` });
    }

    const plan = TaskPlanDraftSchema.parse(JSON.parse(draft.planJson) as unknown);
    const confirmationToken = mintConfirmationToken({
      userId,
      draftId: draft.id,
      planHash: draft.planHash,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    await input.ctx.db
      .update(agentTaskPlannerDrafts)
      .set({
        status: "confirmed",
        confirmationToken,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentTaskPlannerDrafts.id, draft.id));

    return {
      confirmationToken,
      summary: {
        creates: plan.creates.length,
        updates: plan.updates.length,
        statusChanges: plan.statusChanges.length,
        deletes: plan.deletes.length,
      },
    };
  },

  async taskPlannerApply(input: {
    ctx: TRPCContext;
    draftId: string;
    confirmationToken: string;
  }): Promise<{ applied: true; results: { createdTaskIds: number[]; updatedTaskIds: number[]; statusChangedTaskIds: number[]; deletedTaskIds: number[] } }> {
    const userId = requireUserId(input.ctx);

    const payload = readConfirmationToken(input.confirmationToken);
    if (payload.userId !== userId || payload.draftId !== input.draftId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Confirmation token does not match user/draft" });
    }
    if (Date.now() > payload.expiresAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token expired" });
    }

    const [draft] = await input.ctx.db
      .select({
        id: agentTaskPlannerDrafts.id,
        userId: agentTaskPlannerDrafts.userId,
        projectId: agentTaskPlannerDrafts.projectId,
        planJson: agentTaskPlannerDrafts.planJson,
        planHash: agentTaskPlannerDrafts.planHash,
        status: agentTaskPlannerDrafts.status,
        confirmationToken: agentTaskPlannerDrafts.confirmationToken,
      })
      .from(agentTaskPlannerDrafts)
      .where(eq(agentTaskPlannerDrafts.id, input.draftId))
      .limit(1);

    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
    if (draft.status !== "confirmed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Draft is not applicable (status=${draft.status})` });
    }
    if (draft.planHash !== payload.planHash) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Plan hash mismatch" });
    }
    if (draft.confirmationToken !== input.confirmationToken) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token mismatch" });
    }

    const plan = TaskPlanDraftSchema.parse(JSON.parse(draft.planJson) as unknown);

    // `plan.scope.projectId` round-trips through the LLM's JSON output, so it is
    // not a trusted value. `draft.projectId` is the column this server wrote at
    // draft time and is the only authority for where writes may land. They should
    // always agree; a mismatch means the plan was tampered with or the model
    // rewrote the scope, and either way we refuse rather than guess.
    const targetProjectId = draft.projectId;
    if (plan.scope.projectId !== targetProjectId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Plan scope does not match the project this draft was created for",
      });
    }

    // Re-check access at apply time: membership or collaborator permission may
    // have been revoked between draft and apply.
    //
    // Checked per operation kind rather than as a single "write" grant, so a plan
    // that includes deletions needs `canDeleteTasks` exactly as `task.delete`
    // does. Otherwise the agent would be a way to launder a capability the caller
    // does not have.
    if (plan.creates.length > 0) {
      await assertProjectPermission(input.ctx, targetProjectId, "canAssignTasks");
    }
    if (plan.updates.length > 0 || plan.statusChanges.length > 0) {
      await assertProjectPermission(input.ctx, targetProjectId, "canEditProjects");
    }
    if (plan.deletes.length > 0) {
      await assertProjectPermission(input.ctx, targetProjectId, "canDeleteTasks");
    }
    // An empty plan still needs basic write access to be a legitimate request.
    await assertProjectAccess(input.ctx, targetProjectId, "write");

    const createdTaskIds: number[] = [];
    const updatedTaskIds: number[] = [];
    const statusChangedTaskIds: number[] = [];
    const deletedTaskIds: number[] = [];

    // Apply creates with idempotency.
    for (const c of plan.creates) {
      // idempotency: if a task already exists with this clientRequestId, skip create.
      const existing = await input.ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, targetProjectId), eq(tasks.clientRequestId, c.clientRequestId)))
        .limit(1);

      if (existing[0]?.id) {
        createdTaskIds.push(existing[0].id);
        continue;
      }

      const inserted = await input.ctx.db
        .insert(tasks)
        .values({
          title: c.title,
          description: c.description,
          projectId: targetProjectId,
          priority: c.priority,
          assignedToId: c.assignedToId ?? null,
          dueDate: c.dueDate ? new Date(c.dueDate) : null,
          orderIndex: c.orderIndex ?? 0,
          createdById: userId,
          lastEditedById: userId,
          lastEditedAt: new Date(),
          clientRequestId: c.clientRequestId,
        })
        .returning({ id: tasks.id });

      if (inserted[0]?.id) {
        createdTaskIds.push(inserted[0].id);
        await input.ctx.db.insert(taskActivityLog).values({
          taskId: inserted[0].id,
          userId,
          action: "created",
          newValue: "Task created",
        });
      }
    }

    // Apply updates/status changes/deletes (best-effort). These operations are not idempotent via clientRequestId
    // right now; they rely on taskId.
    for (const u of plan.updates) {
      await input.ctx.db
        .update(tasks)
        .set({
          ...u.patch,
          assignedToId:
            "assignedToId" in u.patch
              ? (u.patch.assignedToId ?? null)
              : undefined,
          dueDate:
            "dueDate" in u.patch
              ? (u.patch.dueDate ? new Date(u.patch.dueDate) : null)
              : undefined,
          lastEditedById: userId,
          lastEditedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, u.taskId), eq(tasks.projectId, targetProjectId)));
      updatedTaskIds.push(u.taskId);
      await input.ctx.db.insert(taskActivityLog).values({
        taskId: u.taskId,
        userId,
        action: "updated",
        newValue: "Task updated",
      });
    }

    for (const s of plan.statusChanges) {
      await input.ctx.db
        .update(tasks)
        .set({
          status: s.status,
          completedAt: s.status === "completed" ? new Date() : null,
          completedById: s.status === "completed" ? userId : null,
          // When a task is un-completed by the planner, clear any completion note.
          completionNote: s.status === "completed" ? undefined : null,
          lastEditedById: userId,
          lastEditedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, s.taskId), eq(tasks.projectId, targetProjectId)));
      statusChangedTaskIds.push(s.taskId);
      await input.ctx.db.insert(taskActivityLog).values({
        taskId: s.taskId,
        userId,
        action: "status_changed",
        newValue: s.status,
      });
    }

    for (const d of plan.deletes) {
      if (!d.dangerous) continue;
      await input.ctx.db
        .delete(tasks)
        .where(and(eq(tasks.id, d.taskId), eq(tasks.projectId, targetProjectId)));
      deletedTaskIds.push(d.taskId);
    }

    const resultJson = JSON.stringify({ createdTaskIds, updatedTaskIds, statusChangedTaskIds, deletedTaskIds });

    await input.ctx.db.insert(agentTaskPlannerApplies).values({
      draftId: draft.id,
      userId,
      projectId: draft.projectId,
      planHash: draft.planHash,
      resultJson,
    });

    await input.ctx.db
      .update(agentTaskPlannerDrafts)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentTaskPlannerDrafts.id, draft.id));

    return {
      applied: true as const,
      results: { createdTaskIds, updatedTaskIds, statusChangedTaskIds, deletedTaskIds },
    };
  },

  /**
   * General A1 draft — answers workspace questions with LLM.
   */
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
      console.error(
        `[AgentOrchestrator] LLM call failed for agent=${input.agentId}:`,
        err instanceof Error ? err.message : err,
      );
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
  async generateTaskDrafts(input: TaskDraftInput): Promise<GenerateTaskDraftsOutput> {
    const userId = input.ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // 1. Fetch project details
    const [project] = await input.ctx.db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        createdById: projects.createdById,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    }

    // 2. Authorization check — user must be creator or collaborator
    if (project.createdById !== userId) {
      const [collab] = await input.ctx.db
        .select({ collaboratorId: projectCollaborators.collaboratorId })
        .from(projectCollaborators)
        .where(and(
          eq(projectCollaborators.projectId, input.projectId),
          eq(projectCollaborators.collaboratorId, userId),
        ))
        .limit(1);

      if (!collab) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }
    }

    // 3. Fetch existing tasks to avoid duplication
    const existingTasks = await input.ctx.db
      .select({
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(eq(tasks.projectId, input.projectId))
      .orderBy(desc(tasks.createdAt))
      .limit(50);

    // 4. Fetch available team members
    const collaborators = await input.ctx.db
      .select({
        id: users.id,
        name: users.name,
      })
      .from(projectCollaborators)
      .innerJoin(users, eq(projectCollaborators.collaboratorId, users.id))
      .where(eq(projectCollaborators.projectId, input.projectId));

    // Include the project owner
    const [owner] = await input.ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, project.createdById))
      .limit(1);

    const availableUsers = [
      ...(owner ? [{ id: owner.id, name: owner.name }] : []),
      ...collaborators,
    ];

    // 5. Build the description-aware prompt
    const projectDescription = [
      project.description ?? "",
      input.message ? `\n\nAdditional instructions: ${input.message}` : "",
    ].join("");

    // If no description and no message, use the project title as minimal context
    const effectiveDescription = projectDescription.trim()
      || `Project: "${project.title}". Generate a reasonable set of tasks for a project with this name.`;

    const systemPrompt = getTaskGenerationPrompt({
      projectTitle: project.title,
      projectDescription: effectiveDescription,
      existingTasks,
      availableUsers,
    });

    // 6. Call LLM
    const draftId = createDraftId();

    try {
      const llmResponse = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              input.message ??
              `Analyze the project description and generate a comprehensive task breakdown for "${project.title}".`,
          },
        ],
        temperature: 0.3,
        jsonMode: true,
        maxTokens: 4096,
      });

      // 7. Parse + validate
      const parseResult = await parseAndValidate(
        llmResponse.content,
        TaskGenerationOutputSchema,
      );

      if (!parseResult.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to parse task generation output: ${parseResult.error}`,
        });
      }

      return {
        draftId,
        tasks: parseResult.data.tasks.map((t) => ({
          title: t.title,
          description: t.description ?? "",
          priority: t.priority ?? "medium",
          orderIndex: t.orderIndex ?? 0,
          estimatedDueDays: t.estimatedDueDays ?? null,
        })),
        reasoning: parseResult.data.reasoning ?? "",
        projectTitle: project.title,
        projectDescription: project.description ?? "",
      };
    } catch (err) {
      if (err instanceof TRPCError) throw err;

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          err instanceof Error
            ? `Agent error: ${err.message}`
            : "An unexpected error occurred while generating tasks",
      });
    }
  },

  /**
   * Extract tasks from a PDF document using the LLM.
   * Supports documents in EN, BG, ES, DE, FR (matching i18n config).
   */
  async extractTasksFromPdf(input: PdfTaskInput): Promise<GenerateTaskDraftsOutput> {
    const userId = input.ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // 1. Fetch project details
    const [project] = await input.ctx.db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        createdById: projects.createdById,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    // 2. Authorization check
    if (project.createdById !== userId) {
      const [collab] = await input.ctx.db
        .select({ collaboratorId: projectCollaborators.collaboratorId })
        .from(projectCollaborators)
        .where(and(
          eq(projectCollaborators.projectId, input.projectId),
          // Without this predicate the query returned an arbitrary collaborator
          // and compared it to the caller, denying legitimate collaborators
          // whenever they were not the first row.
          eq(projectCollaborators.collaboratorId, userId),
        ))
        .limit(1);

      if (collab?.collaboratorId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }
    }

    // 3. Extract text from PDF
    let pdfResult: Awaited<ReturnType<typeof extractTextFromPdf>>;
    try {
      pdfResult = await extractTextFromPdf(input.pdfBase64);
    } catch (err) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          err instanceof Error
            ? err.message
            : "Failed to extract text from the PDF",
      });
    }

    // 4. Fetch existing tasks to avoid duplication
    const existingTasks = await input.ctx.db
      .select({
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(eq(tasks.projectId, input.projectId))
      .orderBy(desc(tasks.createdAt))
      .limit(50);

    // 5. Build the PDF-aware prompt
    const systemPrompt = getPdfTaskExtractionPrompt({
      projectTitle: project.title,
      projectDescription: project.description ?? "",
      pdfText: pdfResult.text,
      pdfFileName: input.fileName,
      pdfTruncated: pdfResult.truncated,
      pdfPageCount: pdfResult.numPages,
      existingTasks,
      userMessage: input.message,
    });

    // 6. Call LLM
    const draftId = createDraftId();

    try {
      const llmResponse = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              input.message ??
              `Extract actionable tasks from this PDF document for the project "${project.title}".`,
          },
        ],
        temperature: 0.3,
        jsonMode: true,
        maxTokens: 4096,
      });

      // 7. Parse + validate
      const parseResult = await parseAndValidate(
        llmResponse.content,
        TaskGenerationOutputSchema,
      );

      if (!parseResult.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to parse PDF task extraction output: ${parseResult.error}`,
        });
      }

      return {
        draftId,
        tasks: parseResult.data.tasks.map((t) => ({
          title: t.title,
          description: t.description ?? "",
          priority: t.priority ?? "medium",
          orderIndex: t.orderIndex ?? 0,
          estimatedDueDays: t.estimatedDueDays ?? null,
        })),
        reasoning: parseResult.data.reasoning ?? "",
        projectTitle: project.title,
        projectDescription: project.description ?? "",
      };
    } catch (err) {
      if (err instanceof TRPCError) throw err;

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          err instanceof Error
            ? `Agent error: ${err.message}`
            : "An unexpected error occurred while extracting tasks from the PDF",
      });
    }
  },

  // ---------------------------------------------------------------------------
  // A4 Events Publisher API
  // ---------------------------------------------------------------------------

  async eventsPublisherDraft(input: {
    ctx: TRPCContext;
    message: string;
    handoffContext?: Record<string, unknown>;
  }): Promise<{ draftId: string; plan: EventsPublisherDraft }> {
    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();

    const contextPack = await buildA4Context({ ctx: input.ctx });
    const systemPrompt = getA4SystemPrompt(contextPack);

    const llmResponse = await chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.message },
      ],
      temperature: 0.2,
      jsonMode: true,
    });

    const parseResult = await parseAndValidate(
      llmResponse.content,
      EventsPublisherDraftSchema,
    );
    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A4 plan JSON: ${parseResult.error}`,
      });
    }

    // Server-side guardrail: only allow deletes for events the user owns
    const ownedEventIds = new Set(
      contextPack.events.filter((e) => e.isOwner).map((e) => e.id),
    );
    const guardedPlan: EventsPublisherDraft = {
      ...parseResult.data,
      deletes: parseResult.data.deletes.filter((d) =>
        ownedEventIds.has(d.eventId),
      ),
      updates: parseResult.data.updates.filter((u) =>
        ownedEventIds.has(u.eventId),
      ),
    };

    guardedPlan.planHash = computePlanHash(guardedPlan);

    // Persist draft in memory (could be DB-backed like A2/A3)
    a4DraftStore.set(draftId, { userId, plan: guardedPlan });

    return { draftId, plan: guardedPlan };
  },

  async eventsPublisherConfirm(input: {
    ctx: TRPCContext;
    draftId: string;
    edits?: Array<{ index: number; title?: string; description?: string }>;
  }): Promise<{
    confirmationToken: string;
    summary: {
      creates: number;
      updates: number;
      deletes: number;
      commentsAdded: number;
      commentsRemoved: number;
      rsvps: number;
      likes: number;
    };
  }> {
    const userId = requireUserId(input.ctx);
    const stored = a4DraftStore.get(input.draftId);
    if (stored?.userId !== userId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    }

    let plan = stored.plan;

    // Apply user edits if provided
    if (input.edits && input.edits.length > 0) {
      // Combine creates and updates into a single list for indexing
      // (creates come first, then updates)
      const editableItems = [...plan.creates, ...plan.updates];
      const updatedCreates = [...plan.creates];
      const updatedUpdates = [...plan.updates];
      
      for (const edit of input.edits) {
        if (edit.index >= 0 && edit.index < plan.creates.length) {
          // Edit a create item
          const existing = updatedCreates[edit.index];
          if (existing) {
            updatedCreates[edit.index] = {
              ...existing,
              ...(edit.title && { title: edit.title }),
              ...(edit.description && { description: edit.description }),
            };
          }
        } else if (edit.index >= plan.creates.length && edit.index < editableItems.length) {
          // Edit an update item
          const updateIdx = edit.index - plan.creates.length;
          const existing = updatedUpdates[updateIdx];
          if (existing) {
            updatedUpdates[updateIdx] = {
              ...existing,
              patch: {
                ...existing.patch,
                ...(edit.title && { title: edit.title }),
                ...(edit.description && { description: edit.description }),
              },
            };
          }
        }
      }
      
      plan = { ...plan, creates: updatedCreates, updates: updatedUpdates };
      // Update stored plan
      a4DraftStore.set(input.draftId, { ...stored, plan });
    }

    const planHash = computePlanHash(plan);
    const token = mintConfirmationToken({
      userId,
      draftId: input.draftId,
      planHash,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    return {
      confirmationToken: token,
      summary: {
        creates: plan.creates.length,
        updates: plan.updates.length,
        deletes: plan.deletes.length,
        commentsAdded: plan.comments.add.length,
        commentsRemoved: plan.comments.remove.length,
        rsvps: plan.rsvps.length,
        likes: plan.likes.length,
      },
    };
  },

  async eventsPublisherApply(input: {
    ctx: TRPCContext;
    draftId: string;
    confirmationToken: string;
  }): Promise<EventsPublisherApplyOutput> {
    const userId = requireUserId(input.ctx);
    const tokenPayload = readConfirmationToken(input.confirmationToken);

    if (tokenPayload.userId !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Token user mismatch" });
    }
    if (tokenPayload.draftId !== input.draftId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Token/draft mismatch" });
    }
    if (Date.now() > tokenPayload.expiresAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token expired" });
    }

    const stored = a4DraftStore.get(input.draftId);
    if (stored?.userId !== userId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    }

    const plan = stored.plan;
    const currentHash = computePlanHash(plan);
    if (currentHash !== tokenPayload.planHash) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Plan was modified after confirmation" });
    }

    const results: EventsPublisherApplyOutput["results"] = {
      createdEventIds: [],
      updatedEventIds: [],
      deletedEventIds: [],
      commentsAdded: 0,
      commentsRemoved: 0,
      rsvpsSet: 0,
      likesToggled: 0,
    };

    const db = input.ctx.db;

    // Creates
    for (const create of plan.creates) {
      const [inserted] = await db
        .insert(eventsTable)
        .values({
          title: create.title,
          description: create.description,
          eventDate: new Date(create.eventDate),
          region: create.region,
          enableRsvp: create.enableRsvp,
          sendReminders: create.sendReminders,
          imageUrl: create.imageUrl ?? null,
          createdById: userId,
        })
        .returning({ id: eventsTable.id });
      if (inserted) results.createdEventIds.push(inserted.id);
    }

    // Updates
    for (const update of plan.updates) {
      await db
        .update(eventsTable)
        .set({
          ...(update.patch.title !== undefined && { title: update.patch.title }),
          ...(update.patch.description !== undefined && { description: update.patch.description }),
          ...(update.patch.eventDate !== undefined && { eventDate: new Date(update.patch.eventDate) }),
          ...(update.patch.region !== undefined && { region: update.patch.region }),
          ...(update.patch.enableRsvp !== undefined && { enableRsvp: update.patch.enableRsvp }),
          ...(update.patch.sendReminders !== undefined && { sendReminders: update.patch.sendReminders }),
        })
        .where(eq(eventsTable.id, update.eventId));
      results.updatedEventIds.push(update.eventId);
    }

    // Deletes
    for (const del of plan.deletes) {
      await db.delete(eventsTable).where(eq(eventsTable.id, del.eventId));
      results.deletedEventIds.push(del.eventId);
    }

    // Comments add
    for (const comment of plan.comments.add) {
      await db.insert(eventComments).values({
        eventId: comment.eventId,
        text: comment.text,
        createdById: userId,
      });
      results.commentsAdded++;
    }

    // Comments remove
    for (const comment of plan.comments.remove) {
      await db.delete(eventComments).where(eq(eventComments.id, comment.commentId));
      results.commentsRemoved++;
    }

    // RSVPs
    for (const rsvp of plan.rsvps) {
      // Upsert: delete existing then insert
      await db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, rsvp.eventId),
            eq(eventRsvps.userId, userId),
          ),
        );
      await db.insert(eventRsvps).values({
        eventId: rsvp.eventId,
        status: rsvp.status,
        userId: userId,
      });
      results.rsvpsSet++;
    }

    // Likes
    for (const like of plan.likes) {
      const existing = await db.query.eventLikes.findFirst({
        where: and(
          eq(eventLikes.eventId, like.eventId),
          eq(eventLikes.createdById, userId),
        ),
      });
      if (existing) {
        await db.delete(eventLikes).where(
          and(
            eq(eventLikes.eventId, like.eventId),
            eq(eventLikes.createdById, userId),
          ),
        );
      } else {
        await db.insert(eventLikes).values({
          eventId: like.eventId,
          createdById: userId,
        });
      }
      results.likesToggled++;
    }

    // Cleanup draft
    a4DraftStore.delete(input.draftId);

    return { applied: true as const, results };
  },
};

// In-memory draft store for A4 (mirrors A2/A3 pattern)
const a4DraftStore = new Map<
  string,
  { userId: string; plan: EventsPublisherDraft }
>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
