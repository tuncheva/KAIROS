import { beforeAll, afterAll, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import * as schema from "~/server/db/schema";
import { buildA2Context } from "~/server/llm/context/a2ContextBuilder";

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
 * A2 picks assignees from `assigneeWorkload`, which has to see a candidate's
 * work in *other* projects — including ones the planner's caller cannot open —
 * without leaking what those projects are.
 */
describeIntegration("A2 assignee workload", () => {
  let h: Harness;
  let ownerId: string;
  let bobId: string;
  let projectId: number;
  let hiddenProjectTitle: string;

  beforeAll(async () => {
    h = await createHarness("assigneeload");

    const owner = await makeUser(h.db, { name: "Owner" });
    const bob = await makeUser(h.db, { name: "Bob" });
    const stranger = await makeUser(h.db, { name: "Stranger" });
    ownerId = owner.id;
    bobId = bob.id;

    const org = await makeOrganization(h.db, ownerId);
    await addMember(h.db, org.id, ownerId, "admin");
    const project = await makeProject(h.db, ownerId, org.id);
    projectId = project.id;
    await h.db
      .insert(schema.projectCollaborators)
      .values({ projectId, collaboratorId: bobId, permission: "write" });

    // Bob is busy in a project the owner has no way to see.
    const hidden = await makeProject(h.db, stranger.id, null);
    await h.db
      .insert(schema.projectCollaborators)
      .values({ projectId: hidden.id, collaboratorId: bobId, permission: "write" });
    const [hiddenRow] = await h.db
      .select({ title: schema.projects.title })
      .from(schema.projects)
      .where(eq(schema.projects.id, hidden.id));
    hiddenProjectTitle = hiddenRow!.title;

    const here = await makeTask(h.db, projectId, ownerId);
    await h.db.update(schema.tasks).set({ assignedToId: bobId }).where(eq(schema.tasks.id, here.id));
    for (let i = 0; i < 4; i++) {
      const t = await makeTask(h.db, hidden.id, stranger.id);
      await h.db
        .update(schema.tasks)
        .set({ assignedToId: bobId, dueDate: new Date(Date.now() - 86_400_000) })
        .where(eq(schema.tasks.id, t.id));
      await h.db
        .insert(schema.taskActivityLog)
        .values({ taskId: t.id, userId: bobId, action: "status_changed" });
    }
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it("counts a candidate's work in projects the caller cannot see, without naming them", async () => {
    const ctx = { db: h.db, session: { user: { id: ownerId } } } as unknown as TRPCContext;
    const pack = await buildA2Context({ ctx, scope: { projectId } });

    const bob = pack.assigneeWorkload?.find((w) => w.userId === bobId);
    expect(bob).toBeDefined();
    expect(bob!.openInThisProject).toBe(1);
    expect(bob!.openInOtherProjectsNotVisible).toBe(4);
    expect(bob!.openTasks).toBe(5);
    expect(bob!.overdue).toBe(4);
    expect(bob!.actionsLast14Days).toBe(4);
    expect(bob!.possiblyUnavailable).toBe(false);
    expect(JSON.stringify(pack)).not.toContain(hiddenProjectTitle);

    const owner = pack.assigneeWorkload?.find((w) => w.userId === ownerId);
    expect(owner?.possiblyUnavailable).toBe(true);
  });
});
