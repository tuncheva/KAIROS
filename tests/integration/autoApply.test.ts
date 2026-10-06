import { beforeAll, afterAll, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import {
  createHarness,
  describeIntegration,
  makeUser,
  makeProject,
  type Harness,
} from "./harness";
import type { TRPCContext } from "~/server/api/trpc";
import {
  agentNotesVaultDrafts,
  agentTaskPlannerDrafts,
  stickyNotes,
  tasks,
  users,
} from "~/server/db/schema";
import { autoApplyNotesPlan, autoApplyTaskPlan } from "~/server/llm/orchestrator/autoApply";
import { computePlanHash } from "~/server/llm/orchestrator/shared";
import { NotesVaultDraftSchema } from "~/server/llm/schemas/a3NotesVaultSchemas";
import { TaskPlanDraftSchema } from "~/server/llm/schemas/a2TaskPlannerSchemas";

/**
 * Phase 5 end to end: a small plan applies on its own only when the user opted
 * in, the workspace allows it and undo exists — and then undo brings it back.
 *
 * No model: drafts are written as the draft step leaves them, then handed to
 * the same auto-apply functions the chat handoff calls.
 */
describeIntegration("auto-apply small changes", () => {
  let h: Harness;
  let proId: string;
  let freeId: string;
  let projectId: number;
  let freeProjectId: number;

  const ctxFor = (userId: string) =>
    ({
      db: h.db,
      session: { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" },
      headers: new Headers(),
    }) as unknown as TRPCContext;

  /** A one-task draft for `userId` in `project`, persisted as the draft step would. */
  async function taskDraft(userId: string, project: number, title: string) {
    const plan = TaskPlanDraftSchema.parse({
      agentId: "task_planner",
      scope: { projectId: project },
      creates: [{ title, priority: "medium", clientRequestId: `auto-${title}-0001` }],
    });
    const { planHash: _ignored, ...unhashed } = plan;
    const planHash = computePlanHash(unhashed);
    const draftId = `a2_auto_${title}_${Date.now()}`;
    await h.db.insert(agentTaskPlannerDrafts).values({
      id: draftId,
      userId,
      projectId: project,
      message: title,
      planJson: JSON.stringify({ ...plan, planHash }),
      planHash,
      status: "draft",
    });
    return { draftId, plan: { ...plan, planHash } };
  }

  async function tasksTitled(title: string) {
    return h.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.title, title));
  }

  beforeAll(async () => {
    h = await createHarness("autoapply");
    // Pro carries the undo entitlement; free does not.
    proId = (await makeUser(h.db, { name: "Pro", plan: "pro" })).id;
    freeId = (await makeUser(h.db, { name: "Free" })).id;
    projectId = (await makeProject(h.db, proId, null)).id;
    freeProjectId = (await makeProject(h.db, freeId, null)).id;
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it("leaves the plan for Confirm until the user opts in", async () => {
    const { draftId, plan } = await taskDraft(proId, projectId, "not-yet");
    expect(await autoApplyTaskPlan(ctxFor(proId), draftId, plan)).toBeNull();
    expect(await tasksTitled("not-yet")).toHaveLength(0);
  });

  it("applies a small plan for someone who opted in, and undo removes it", async () => {
    await h.caller(proId).agent.setSetting({ id: "task_planner.approval", value: "autoSmall" });

    const { draftId, plan } = await taskDraft(proId, projectId, "auto-saved");
    expect(await autoApplyTaskPlan(ctxFor(proId), draftId, plan)).toEqual({ changed: 1 });
    expect(await tasksTitled("auto-saved")).toHaveLength(1);

    const undone = await h.caller(proId).agent.undoApply({ draftId, kind: "tasks" });
    expect(undone.undone.tasksDeleted).toBe(1);
    expect(await tasksTitled("auto-saved")).toHaveLength(0);
  });

  it("does nothing where the workspace switched it off", async () => {
    // No workspace here, so the workspace-scoped switch lives on the user too.
    await h.caller(proId).agent.setSetting({ id: "task_planner.allowAutoApply", value: false });
    const { draftId, plan } = await taskDraft(proId, projectId, "switched-off");
    expect(await autoApplyTaskPlan(ctxFor(proId), draftId, plan)).toBeNull();
    expect(await tasksTitled("switched-off")).toHaveLength(0);
    await h.caller(proId).agent.setSetting({ id: "task_planner.allowAutoApply", value: true });
  });

  it("never applies on its own without undo, even when opted in", async () => {
    await h.db
      .update(users)
      .set({ agentSettings: { "task_planner.approval": "autoSmall" } })
      .where(eq(users.id, freeId));
    const { draftId, plan } = await taskDraft(freeId, freeProjectId, "no-undo");
    expect(await autoApplyTaskPlan(ctxFor(freeId), draftId, plan)).toBeNull();
    expect(await tasksTitled("no-undo")).toHaveLength(0);
  });

  it("applies a small notes plan for someone who opted in", async () => {
    await h.caller(proId).agent.setSetting({ id: "notes_vault.approval", value: "autoSmall" });

    const plan = NotesVaultDraftSchema.parse({
      agentId: "notes_vault",
      summary: "One note.",
      operations: [{ type: "create", content: "auto-note-body" }],
    });
    const { planHash: _ignored, ...unhashed } = plan;
    const planHash = computePlanHash(unhashed);
    const draftId = `a3_auto_${Date.now()}`;
    await h.db.insert(agentNotesVaultDrafts).values({
      id: draftId,
      userId: proId,
      message: "note",
      planJson: JSON.stringify({ ...plan, planHash }),
      planHash,
      status: "draft",
    });

    expect(await autoApplyNotesPlan(ctxFor(proId), draftId, { ...plan, planHash })).toEqual({
      changed: 1,
    });
    const created = await h.db
      .select({ id: stickyNotes.id })
      .from(stickyNotes)
      .where(eq(stickyNotes.content, "auto-note-body"));
    expect(created).toHaveLength(1);
  });
});
