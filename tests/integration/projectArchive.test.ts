import { beforeAll, afterAll, it, expect } from "vitest";

import {
  createHarness,
  describeIntegration,
  makeUser,
  makeProject,
  type Harness,
} from "./harness";

/**
 * Archive and reopen, against a real database.
 *
 * The pair had no caller before this, so the split between `getMyProjects` and
 * the new `getArchivedProjects` had never been exercised: the whole point is
 * that a project is in exactly one of them at a time, and that the round trip
 * puts it back. No LLM here — this is plain CRUD and authorization.
 */
describeIntegration("project archive", () => {
  let h: Harness;
  let ownerId: string;
  let strangerId: string;
  let projectId: number;

  beforeAll(async () => {
    h = await createHarness("projarchive");

    const owner = await makeUser(h.db, { name: "Teodora Owner" });
    const stranger = await makeUser(h.db, { name: "Somebody Else" });
    ownerId = owner.id;
    strangerId = stranger.id;

    const project = await makeProject(h.db, ownerId, null);
    projectId = project.id;
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it("moves a project between the two lists and back", async () => {
    const caller = h.caller(ownerId);

    // Starts live.
    expect(
      (await caller.project.getMyProjects()).map((p) => p.id),
    ).toContain(projectId);
    expect(
      (await caller.project.getArchivedProjects()).map((p) => p.id),
    ).not.toContain(projectId);

    await caller.project.archiveProject({ projectId });

    // Exactly one list holds it at a time — this is what makes the archive the
    // only route back to a project the live list has stopped rendering.
    expect(
      (await caller.project.getMyProjects()).map((p) => p.id),
    ).not.toContain(projectId);
    expect(
      (await caller.project.getArchivedProjects()).map((p) => p.id),
    ).toContain(projectId);

    await caller.project.reopenProject({ projectId });

    expect(
      (await caller.project.getMyProjects()).map((p) => p.id),
    ).toContain(projectId);
    expect(
      (await caller.project.getArchivedProjects()).map((p) => p.id),
    ).not.toContain(projectId);
  });

  it("keeps an archived project openable, so it can be reopened", async () => {
    const caller = h.caller(ownerId);

    await caller.project.archiveProject({ projectId });
    // `getById` deliberately does not filter on status.
    const detail = await caller.project.getById({ id: projectId });
    expect(detail.id).toBe(projectId);
    expect(detail.status).toBe("archived");

    await caller.project.reopenProject({ projectId });
  });

  it("refuses to archive a project the caller does not own", async () => {
    await expect(
      h.caller(strangerId).project.archiveProject({ projectId }),
    ).rejects.toThrow();
  });

  it("refuses to reopen a project the caller does not own", async () => {
    await h.caller(ownerId).project.archiveProject({ projectId });

    await expect(
      h.caller(strangerId).project.reopenProject({ projectId }),
    ).rejects.toThrow();

    await h.caller(ownerId).project.reopenProject({ projectId });
  });

  it("does not leak another user's archive", async () => {
    await h.caller(ownerId).project.archiveProject({ projectId });

    const theirs = await h.caller(strangerId).project.getArchivedProjects();
    expect(theirs.map((p) => p.id)).not.toContain(projectId);

    await h.caller(ownerId).project.reopenProject({ projectId });
  });
});
