import { beforeAll, afterAll, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import {
  createHarness,
  describeIntegration,
  makeUser,
  makeOrganization,
  makeProject,
  addMember,
  type Harness,
} from "./harness";
import {
  agentProjectManagerDrafts,
  agentTaskPlannerDrafts,
  organizations,
  projects,
  tasks,
  users,
} from "~/server/db/schema";
import { computePlanHash } from "~/server/llm/orchestrator/shared";
import { ProjectManagerDraftSchema } from "~/server/llm/schemas/a6ProjectManagerSchemas";
import { TaskPlanDraftSchema } from "~/server/llm/schemas/a2TaskPlannerSchemas";

/**
 * Agent scope (Phase 4) and the settings API behind it, end to end.
 *
 * No model involved: the drafts are written straight into their tables, the
 * way the draft step would have left them, and then go through the real
 * confirm and apply procedures. Apply is where scope has to hold — a draft can
 * outlive a change to the setting, and the context filter is only a courtesy.
 */
describeIntegration("agent scope", () => {
  let h: Harness;
  let adminId: string;
  let memberId: string;
  let orgId: number;
  let inScope: number;
  let outOfScope: number;

  beforeAll(async () => {
    h = await createHarness("agentscope");

    adminId = (await makeUser(h.db, { name: "Admin" })).id;
    memberId = (await makeUser(h.db, { name: "Member" })).id;
    orgId = (await makeOrganization(h.db, adminId)).id;
    await addMember(h.db, orgId, adminId, "admin");
    await addMember(h.db, orgId, memberId, "member");
    await h.db.update(users).set({ activeOrganizationId: orgId }).where(eq(users.id, adminId));
    await h.db.update(users).set({ activeOrganizationId: orgId }).where(eq(users.id, memberId));

    inScope = (await makeProject(h.db, adminId, orgId)).id;
    outOfScope = (await makeProject(h.db, adminId, orgId)).id;
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it("lets only an admin narrow a workspace scope, and refuses an empty one", async () => {
    await expect(
      h.caller(memberId).agent.setSetting({
        id: "project_manager.scope",
        value: { mode: "only", projectIds: [inScope] },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      h.caller(adminId).agent.setSetting({
        id: "project_manager.scope",
        value: { mode: "only", projectIds: [] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    for (const id of ["project_manager.scope", "task_planner.scope"] as const) {
      await h.caller(adminId).agent.setSetting({
        id,
        value: { mode: "only", projectIds: [inScope, inScope] },
      });
    }

    // Stored on the workspace, deduplicated, and read back by every member.
    const [org] = await h.db
      .select({ settings: organizations.agentSettings })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    expect(org?.settings["project_manager.scope"]).toEqual({ mode: "only", projectIds: [inScope] });

    const seen = await h.caller(memberId).agent.settings();
    expect(seen.values["task_planner.scope"]).toEqual({ mode: "only", projectIds: [inScope] });
    expect(seen.canEditWorkspace).toBe(false);
  });

  it("applies a project manager plan only inside the scope", async () => {
    const plan = ProjectManagerDraftSchema.parse({
      agentId: "project_manager",
      summary: "Rename two projects.",
      updates: [
        {
          projectId: inScope,
          projectTitle: "In scope",
          patch: { title: "Renamed inside" },
          rationale: "Asked to rename it.",
        },
        {
          projectId: outOfScope,
          projectTitle: "Out of scope",
          patch: { title: "Renamed outside" },
          rationale: "Asked to rename it.",
        },
      ],
    });
    const { planHash: _ignored, ...unhashed } = plan;
    const planHash = computePlanHash(unhashed);
    const draftId = `a6_scope_${Date.now()}`;
    await h.db.insert(agentProjectManagerDrafts).values({
      id: draftId,
      userId: adminId,
      message: "rename both",
      planJson: JSON.stringify({ ...plan, planHash }),
      planHash,
      status: "draft",
    });

    const caller = h.caller(adminId);
    const { confirmationToken } = await caller.agent.projectManagerConfirm({ draftId });
    const applied = await caller.agent.projectManagerApply({ draftId, confirmationToken });

    expect(applied.results.refused.join(" ")).toContain("outside the projects this agent may change");

    const rows = await h.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.organizationId, orgId));
    expect(rows.find((r) => r.id === inScope)?.title).toBe("Renamed inside");
    expect(rows.find((r) => r.id === outOfScope)?.title).not.toBe("Renamed outside");
  });

  it("refuses a task plan for a project outside the scope", async () => {
    const plan = TaskPlanDraftSchema.parse({
      agentId: "task_planner",
      scope: { projectId: outOfScope },
      creates: [
        { title: "Should not exist", priority: "medium", clientRequestId: "scope-test-0001" },
      ],
    });
    const { planHash: _ignored, ...unhashed } = plan;
    const planHash = computePlanHash(unhashed);
    const draftId = `a2_scope_${Date.now()}`;
    await h.db.insert(agentTaskPlannerDrafts).values({
      id: draftId,
      userId: adminId,
      projectId: outOfScope,
      message: "add a task",
      planJson: JSON.stringify({ ...plan, planHash }),
      planHash,
      status: "draft",
    });

    const caller = h.caller(adminId);
    const { confirmationToken } = await caller.agent.taskPlannerConfirm({ draftId });
    await expect(
      caller.agent.taskPlannerApply({ draftId, confirmationToken }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const created = await h.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, outOfScope));
    expect(created).toHaveLength(0);
  });
});
