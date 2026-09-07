import { beforeAll, afterAll, it, expect } from "vitest";

import {
  createHarness,
  describeIntegration,
  makeUser,
  makeOrganization,
  addMember,
  makeProject,
  makeTask,
  type Harness,
} from "./harness";

/**
 * The two delete routes, and the capabilities the client now paints from.
 *
 * `task.delete` and `task.getActivityLog` both shipped without a caller. The
 * panel showed one trash button to anyone with write access and pointed it at
 * `task.adminDiscard`, so a contributor got a control the server refused. These
 * pin the split the UI relies on: `getById` must report each capability exactly
 * as the mutation would enforce it, or the button lies again.
 */
describeIntegration("task removal and history", () => {
  let h: Harness;
  let ownerId: string;
  let adminId: string;
  let contributorId: string;
  let orgId: number;
  let projectId: number;

  beforeAll(async () => {
    h = await createHarness("taskremoval");

    const owner = await makeUser(h.db, { name: "Owner" });
    const admin = await makeUser(h.db, { name: "Admin" });
    const contributor = await makeUser(h.db, { name: "Contributor" });
    ownerId = owner.id;
    adminId = admin.id;
    contributorId = contributor.id;

    const org = await makeOrganization(h.db, ownerId);
    orgId = org.id;

    await addMember(h.db, orgId, ownerId, "admin");
    await addMember(h.db, orgId, adminId, "admin");
    // `worker` is the contributor template: write access, no delete flag.
    await addMember(h.db, orgId, contributorId, "worker");

    const project = await makeProject(h.db, ownerId, orgId);
    projectId = project.id;
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it("reports capabilities that match what the mutations enforce", async () => {
    const asContributor = await h
      .caller(contributorId)
      .project.getById({ id: projectId });

    // The exact case the old UI got wrong.
    expect(asContributor.userHasWriteAccess).toBe(true);
    expect(asContributor.userCanDeleteTasks).toBe(false);
    expect(asContributor.userCanDiscardTasks).toBe(false);

    const asOwner = await h.caller(ownerId).project.getById({ id: projectId });
    expect(asOwner.userCanDiscardTasks).toBe(true);

    const asAdmin = await h.caller(adminId).project.getById({ id: projectId });
    expect(asAdmin.userCanDiscardTasks).toBe(true);
  });

  it("refuses task.delete to a contributor without the flag", async () => {
    const task = await makeTask(h.db, projectId, ownerId);

    await expect(
      h.caller(contributorId).task.delete({ taskId: task.id }),
    ).rejects.toThrow();

    // Still there.
    const after = await h.caller(ownerId).project.getById({ id: projectId });
    expect(after.tasks.map((t) => t.id)).toContain(task.id);
  });

  it("refuses adminDiscard to a contributor", async () => {
    const task = await makeTask(h.db, projectId, ownerId);

    await expect(
      h.caller(contributorId).task.adminDiscard({ taskId: task.id }),
    ).rejects.toThrow();
  });

  it("lets an org admin discard, and an owner delete", async () => {
    const one = await makeTask(h.db, projectId, ownerId);
    await h.caller(adminId).task.adminDiscard({ taskId: one.id });

    const two = await makeTask(h.db, projectId, ownerId);
    await h.caller(ownerId).task.delete({ taskId: two.id });

    const after = await h.caller(ownerId).project.getById({ id: projectId });
    const ids = after.tasks.map((t) => t.id);
    expect(ids).not.toContain(one.id);
    expect(ids).not.toContain(two.id);
  });

  it("returns a task's history with the person attached", async () => {
    const task = await makeTask(h.db, projectId, ownerId);
    await h
      .caller(ownerId)
      .task.updateStatus({ taskId: task.id, status: "in_progress" });

    const log = await h.caller(ownerId).task.getActivityLog({
      taskId: task.id,
    });

    expect(log.length).toBeGreaterThan(0);

    // The whole point of the join: a row a reader can render. Before this the
    // query returned a bare userId and nothing else about who acted.
    const row = log[0]!;
    expect(row).toHaveProperty("user");
    expect(row).toHaveProperty("taskTitle");
    expect(row.taskTitle).toBeTruthy();

    // Newest first, so the drawer reads from the top.
    const times = log.map((r) => new Date(r.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // Scoped to the one task.
    expect(new Set(log.map((r) => r.taskId))).toEqual(new Set([task.id]));
  });

  it("refuses a task's history to someone outside the project", async () => {
    const stranger = await makeUser(h.db, { name: "Stranger" });
    const task = await makeTask(h.db, projectId, ownerId);

    await expect(
      h.caller(stranger.id).task.getActivityLog({ taskId: task.id }),
    ).rejects.toThrow();
  });
});
