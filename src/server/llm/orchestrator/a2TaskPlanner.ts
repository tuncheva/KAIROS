/**
 * A2 — Task Planner: draft, confirm and apply a plan of task changes.
 *
 * Apply is the security-critical path: it binds to `draft.projectId` (the value this
 * server wrote) rather than `plan.scope.projectId` (which round-trips through the
 * model), and requires a capability per operation kind so the agent cannot launder
 * a permission the caller lacks.
 */

import {
  TRPCError,
} from "@trpc/server";
import crypto from "node:crypto";
import {
  eq,
  and,
} from "drizzle-orm";

import type {
  TRPCContext,
} from "~/server/api/trpc";
import {
  assertProjectAccess,
  assertProjectPermission,
} from "~/server/api/authz";

import {
  TaskPlanDraftSchema,
  TaskPlanModelOutputSchema,
  type TaskPlanDraft,
} from "~/server/llm/schemas/a2TaskPlannerSchemas";

import {
  buildA2Context,
} from "~/server/llm/context/a2ContextBuilder";

import {
  getA2SystemPrompt,
} from "~/server/llm/prompts/a2Prompts";

import {
  A1_READ_TOOLS,
} from "~/server/llm/tools/a1/readTools";

import {
  completeJson,
} from "~/server/llm/core/jsonRepair";

import {
  tasks,
  taskActivityLog,
  agentTaskPlannerDrafts,
  agentTaskPlannerApplies,
} from "~/server/db/schema";
import {
  createDraftId,
  requireUserId,
  computePlanHash,
  mintConfirmationToken,
  readConfirmationToken,
} from "./shared";
/**
 * The plan a refinement is revising, as JSON, or null.
 *
 * Never throws. A stale or foreign draft id means "no prior plan", so the turn
 * degrades to a normal draft rather than failing — the user asked for a change,
 * and answering with a fresh plan beats answering with an error.
 */
async function loadRefinablePlan(
  ctx: TRPCContext,
  draftId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await ctx.db
    .select({
      planJson: agentTaskPlannerDrafts.planJson,
      status: agentTaskPlannerDrafts.status,
      userId: agentTaskPlannerDrafts.userId,
    })
    .from(agentTaskPlannerDrafts)
    .where(eq(agentTaskPlannerDrafts.id, draftId))
    .limit(1);

  if (row?.userId !== userId) return null;
  if (row.status === "applied" || row.status === "expired") return null;

  return row.planJson;
}

export const a2TaskPlanner = {
  async taskPlannerDraft(input: {
    ctx: TRPCContext;
    message: string;
    scope?: { orgId?: string | number; projectId?: number };
    handoffContext?: Record<string, unknown>;
    /**
     * E-3 — the plan this message is refining.
     *
     * "Change the third one's due date to Friday and drop the seventh" used to
     * produce a brand-new plan from the original request, losing every edit the
     * user had already accepted and often renumbering the items they were
     * referring to. With the prior plan in context the model revises it instead,
     * and the resulting hash is recomputed so the confirmation token binds to
     * what the user actually last saw.
     */
    priorDraftId?: string;
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
      // Every project the caller can reach, not just the ones they created.
      // Filtering on `createdById` made A2 blind to org and collaborator
      // projects — so A1, whose `listProjects` sees them, would hand off a
      // shared project by name and A2 would answer "which project?" forever.
      // Reusing the tool keeps the two agents on one definition of visibility.
      const userProjects = await A1_READ_TOOLS.listProjects.execute(input.ctx, {
        limit: 50,
      });

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

    // E-3: load the plan being refined, if any. Scoped to the caller and to
    // drafts that have not been applied — refining something already written to
    // the database is not a refinement, it is a second change, and it should go
    // through a fresh plan so the diff the user approves is honest.
    const priorPlanJson = input.priorDraftId
      ? await loadRefinablePlan(input.ctx, input.priorDraftId, userId)
      : null;

    const parseResult = await completeJson({
      messages: [
        { role: "system", content: systemPrompt },
        ...(priorPlanJson
          ? [
              {
                role: "system" as const,
                content: `The user is refining this existing plan. Return the COMPLETE revised plan — every item they did not ask you to change must survive unchanged, with the same wording. Do not start over.\n\n${priorPlanJson}`,
              },
            ]
          : []),
        { role: "user", content: input.message },
      ],
      schema: TaskPlanModelOutputSchema,
      temperature: 0.2,
      purpose: input.priorDraftId ? "a2.refine" : "a2.draft",
      userId,
    });

    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A2 plan JSON: ${parseResult.error}`,
      });
    }

    // Everything the model must not be trusted to produce is filled in here:
    // the project the plan applies to (already resolved and authorized above)
    // and one idempotency key per created task.
    const draftPlan: TaskPlanDraft = {
      ...parseResult.data,
      scope: {
        orgId: input.scope?.orgId,
        projectId: resolvedProjectId,
      },
      creates: parseResult.data.creates.map((c) => ({
        ...c,
        clientRequestId: crypto.randomUUID(),
      })),
    };

    const planHash = computePlanHash(draftPlan);
    const plan: TaskPlanDraft = { ...draftPlan, planHash };

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
};
