import { beforeAll, afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";

import {
  addMember,
  createHarness,
  describeIntegration,
  makeOrganization,
  makeProject,
  makeTask,
  makeUser,
  type Harness,
} from "./harness";

/**
 * `progress.getTeam` — the admin view of /progress — against a real database.
 *
 * The gate is the point. Every member of an organisation may open one
 * teammate's record, and always could; the whole team side by side is for
 * admins, and the contributor template's `canViewAnalytics` must not be what
 * decides it, because every ordinary member has that flag.
 */
describeIntegration("progress team view", () => {
  let h: Harness;
  let adminId: string;
  let memberId: string;
  let leaverId: string;
  let loneId: string;

  beforeAll(async () => {
    h = await createHarness("progressteam");

    const admin = await makeUser(h.db, { name: "Maya Admin" });
    const member = await makeUser(h.db, { name: "Petar Member" });
    const leaver = await makeUser(h.db, { name: "Gone Person" });
    const lone = await makeUser(h.db, { name: "Solo User" });
    adminId = admin.id;
    memberId = member.id;
    leaverId = leaver.id;
    loneId = lone.id;

    const org = await makeOrganization(h.db, adminId);
    await addMember(h.db, org.id, adminId, "admin");
    await addMember(h.db, org.id, memberId, "member");

    for (const id of [adminId, memberId]) {
      await h.db
        .update(schema.users)
        .set({ activeOrganizationId: org.id })
        .where(eq(schema.users.id, id));
    }

    const project = await makeProject(h.db, adminId, org.id);

    // Two finishes by the member, one open task on them.
    for (let i = 0; i < 2; i++) {
      const task = await makeTask(h.db, project.id, adminId);
      await h.db
        .update(schema.tasks)
        .set({
          status: "completed",
          assignedToId: memberId,
          completedById: memberId,
          completedAt: new Date(),
        })
        .where(eq(schema.tasks.id, task.id));
    }
    const open = await makeTask(h.db, project.id, adminId);
    await h.db
      .update(schema.tasks)
      .set({ assignedToId: memberId })
      .where(eq(schema.tasks.id, open.id));

    // Credited to someone who is not (or no longer) in the organisation.
    const stray = await makeTask(h.db, project.id, adminId);
    await h.db
      .update(schema.tasks)
      .set({ status: "completed", completedById: leaverId, completedAt: new Date() })
      .where(eq(schema.tasks.id, stray.id));
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it("tells the page who may switch to the team", async () => {
    const asAdmin = await h.caller(adminId).progress.getLeaderboard();
    const asMember = await h.caller(memberId).progress.getLeaderboard();
    expect(asAdmin.canViewTeam).toBe(true);
    // A member holds `canViewAnalytics` by default and still may not.
    expect(asMember.canViewTeam).toBe(false);
  });

  it("gives an admin every member, their load and their finishes", async () => {
    const team = await h.caller(adminId).progress.getTeam({ days: 30 });

    expect(team.members.map((m) => m.id).sort()).toEqual([adminId, memberId].sort());
    const member = team.members.find((m) => m.id === memberId)!;
    expect(member.role).toBe("member");
    expect(member.open).toBe(1);
    expect(member.workload).toHaveLength(1);
    expect(member.lastFinishedAt).not.toBeNull();

    const byMember = team.completions.filter((c) => c.userId === memberId);
    expect(byMember).toHaveLength(2);
    expect(team.members.find((m) => m.id === adminId)!.isSelf).toBe(true);
  });

  it("does not count work by people outside the organisation", async () => {
    const team = await h.caller(adminId).progress.getTeam({ days: 30 });
    expect(team.completions.some((c) => c.userId === leaverId)).toBe(false);
  });

  it("refuses an ordinary member", async () => {
    await expect(h.caller(memberId).progress.getTeam({ days: 30 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a personal workspace, which has no admin", async () => {
    await expect(h.caller(loneId).progress.getTeam({ days: 30 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
