import { beforeAll, afterAll, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
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
 * Regression tests for the four P0 cross-tenant findings, executed against a real
 * database through real tRPC procedures.
 *
 * Every test here asserts the **negative** case — that someone who should not be
 * able to do a thing gets `FORBIDDEN` — because that is precisely what the
 * source-grep tests could not see. Each of these would have failed before the
 * corresponding fix.
 */

let h: Harness;

beforeAll(async () => {
  h = await createHarness("authz");
}, 120_000);

afterAll(async () => {
  await h?.cleanup();
});

async function expectForbidden(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(TRPCError);
  await promise.catch((err: unknown) => {
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });
}

describeIntegration("task authorization", () => {
  it("refuses a stranger reading another tenant's tasks", async () => {
    // Finding #1: the agent's read tools filtered on projectId alone. The router
    // path is the same shape — a project id from the caller, no membership check.
    const owner = await makeUser(h.db);
    const stranger = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    const project = await makeProject(h.db, owner.id, org.id);
    await makeTask(h.db, project.id, owner.id);

    await expectForbidden(
      h.caller(stranger.id).task.getByProject({ projectId: project.id }),
    );
  });

  it("refuses a stranger creating a task in another tenant's project", async () => {
    const owner = await makeUser(h.db);
    const stranger = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    const project = await makeProject(h.db, owner.id, org.id);

    await expectForbidden(
      h.caller(stranger.id).task.create({
        projectId: project.id,
        title: "injected",
        priority: "medium",
      }),
    );
  });

  it("lets a contributor create a task in their own organization", async () => {
    // The positive case matters too: a check that forbids everyone is not a fix.
    const owner = await makeUser(h.db);
    const member = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, member.id, "member");
    const project = await makeProject(h.db, owner.id, org.id);

    const task = await h.caller(member.id).task.create({
      projectId: project.id,
      title: "legitimate",
      priority: "low",
    });

    expect(task?.title).toBe("legitimate");
  });

  it("refuses a mentor every write, on the server", async () => {
    // Finding #4: the view-only role was enforced only in the browser.
    const owner = await makeUser(h.db);
    const mentor = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, mentor.id, "mentor");
    const project = await makeProject(h.db, owner.id, org.id);
    const task = await makeTask(h.db, project.id, owner.id);

    await expectForbidden(
      h.caller(mentor.id).task.create({
        projectId: project.id,
        title: "mentor write",
        priority: "medium",
      }),
    );
    await expectForbidden(
      h.caller(mentor.id).task.update({ taskId: task.id, title: "renamed" }),
    );
    await expectForbidden(
      h.caller(mentor.id).task.updateStatus({ taskId: task.id, status: "completed" }),
    );
    await expectForbidden(h.caller(mentor.id).task.delete({ taskId: task.id }));
  });

  it("refuses a contributor deleting a task without canDeleteTasks", async () => {
    // Finding #4: the column was written at membership creation and never read.
    const owner = await makeUser(h.db);
    const member = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, member.id, "member");
    const project = await makeProject(h.db, owner.id, org.id);
    const task = await makeTask(h.db, project.id, owner.id);

    await expectForbidden(h.caller(member.id).task.delete({ taskId: task.id }));
  });

  it("allows deletion once canDeleteTasks is granted", async () => {
    const owner = await makeUser(h.db);
    const member = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, member.id, "member", { canDeleteTasks: true });
    const project = await makeProject(h.db, owner.id, org.id);
    const task = await makeTask(h.db, project.id, owner.id);

    await expect(
      h.caller(member.id).task.delete({ taskId: task.id }),
    ).resolves.toEqual({ success: true });
  });

  it("does not exempt a project owner from the flag check", async () => {
    // "Strict flags": inside an organization the columns are the authority, so
    // having created the project does not grant deletion.
    const owner = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "member");
    const project = await makeProject(h.db, owner.id, org.id);
    const task = await makeTask(h.db, project.id, owner.id);

    await expectForbidden(h.caller(owner.id).task.delete({ taskId: task.id }));
  });
});

describeIntegration("agent authorization", () => {
  it("refuses the AI task planner on a project the caller cannot reach", async () => {
    // Finding #1's write half: `taskPlannerDraft` accepted a caller-supplied
    // projectId and persisted a draft against it with no authorization at all.
    const owner = await makeUser(h.db);
    const stranger = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    const project = await makeProject(h.db, owner.id, org.id);

    await expectForbidden(
      h.caller(stranger.id).agent.taskPlannerDraft({
        message: "add three tasks",
        // The project id arrives inside `scope`, which is exactly the
        // caller-supplied value that used to be trusted.
        scope: { projectId: project.id },
      }),
    );
  });
});

describeIntegration("organization authorization", () => {
  it("refuses a non-admin inviting an admin", async () => {
    // Finding #5: `inviteMember` admitted anyone holding `canAddMembers` and then
    // accepted an arbitrary role string, so a delegated inviter could invite an
    // address they control as admin.
    const owner = await makeUser(h.db);
    const delegate = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, delegate.id, "member", { canAddMembers: true });

    await expectForbidden(
      h.caller(delegate.id).organization.inviteMember({
        organizationId: org.id,
        email: "attacker@example.test",
        role: "admin",
      }),
    );
  });

  it("still lets that delegate invite an ordinary member", async () => {
    const owner = await makeUser(h.db);
    const delegate = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, delegate.id, "member", { canAddMembers: true });

    await expect(
      h.caller(delegate.id).organization.inviteMember({
        organizationId: org.id,
        email: "colleague@example.test",
        role: "member",
      }),
    ).resolves.toBeTruthy();
  });

  it("never sends the access code to the client", async () => {
    // Finding #28: the code is a permanent bearer credential for the workspace and
    // was returned to every member, including guests and view-only mentors. It is
    // no longer part of the payload at all — invites are short-lived QR tokens.
    const owner = await makeUser(h.db);
    const mentor = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, mentor.id, "mentor");

    const asAdmin = await h.caller(owner.id).organization.listMine();
    expect(JSON.stringify(asAdmin)).not.toContain(org.accessCode);

    // Who may hand out access is still role-gated: a view-only mentor cannot.
    expect(asAdmin.find((o) => o.id === org.id)?.canInvite).toBe(true);
    const asMentor = await h.caller(mentor.id).organization.listMine();
    expect(asMentor.find((o) => o.id === org.id)?.canInvite).toBe(false);
  });
});

describeIntegration("organization join QR codes", () => {
  it("refuses to mint a QR for a member who cannot add people", async () => {
    const owner = await makeUser(h.db);
    const mentor = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");
    await addMember(h.db, org.id, mentor.id, "mentor");

    await expectForbidden(
      h.caller(mentor.id).organization.rotateJoinQr({ organizationId: org.id }),
    );
    await expectForbidden(
      h.caller(mentor.id).organization.getJoinQr({ organizationId: org.id }),
    );
  });

  it("refuses to mint a QR for a non-member", async () => {
    const owner = await makeUser(h.db);
    const outsider = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");

    await expectForbidden(
      h.caller(outsider.id).organization.rotateJoinQr({ organizationId: org.id }),
    );
  });

  it("retires the previous token when a new one is minted", async () => {
    const owner = await makeUser(h.db);
    const scanner = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");

    const first = await h
      .caller(owner.id)
      .organization.rotateJoinQr({ organizationId: org.id });
    const second = await h
      .caller(owner.id)
      .organization.rotateJoinQr({ organizationId: org.id });

    expect(second.code).not.toBe(first.code);

    // A photograph of the previous QR is worthless the moment it rotates.
    await expect(
      h.caller(scanner.id).organization.peekJoinQr({ code: first.code }),
    ).resolves.toMatchObject({ status: "revoked" });

    // And the live one is the one the dialog would show.
    const current = await h
      .caller(owner.id)
      .organization.getJoinQr({ organizationId: org.id });
    expect(current?.code).toBe(second.code);
  });

  it("rejects an expired token", async () => {
    const owner = await makeUser(h.db);
    const scanner = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");

    const qr = await h
      .caller(owner.id)
      .organization.rotateJoinQr({ organizationId: org.id });

    await h.db
      .update(schema.organizationJoinCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.organizationJoinCodes.code, qr.code));

    await expect(
      h.caller(scanner.id).organization.peekJoinQr({ code: qr.code }),
    ).resolves.toMatchObject({ status: "expired" });

    await expect(
      h.caller(scanner.id).organization.joinWithQr({ code: qr.code }),
    ).rejects.toBeInstanceOf(TRPCError);

    // An expired token is also not what `getJoinQr` hands the dialog.
    await expect(
      h.caller(owner.id).organization.getJoinQr({ organizationId: org.id }),
    ).resolves.toBeNull();
  });

  it("lets exactly one person through a single-use token", async () => {
    const owner = await makeUser(h.db);
    const first = await makeUser(h.db);
    const second = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");

    const qr = await h
      .caller(owner.id)
      .organization.rotateJoinQr({ organizationId: org.id });

    await expect(
      h.caller(first.id).organization.joinWithQr({ code: qr.code }),
    ).resolves.toMatchObject({ organizationId: org.id, role: "worker" });

    await expect(
      h.caller(second.id).organization.joinWithQr({ code: qr.code }),
    ).rejects.toBeInstanceOf(TRPCError);

    await expect(
      h.caller(second.id).organization.peekJoinQr({ code: qr.code }),
    ).resolves.toMatchObject({ status: "used" });
  });

  it("honours the role the token was minted for", async () => {
    const owner = await makeUser(h.db);
    const scanner = await makeUser(h.db);
    const org = await makeOrganization(h.db, owner.id);
    await addMember(h.db, org.id, owner.id, "admin");

    const qr = await h
      .caller(owner.id)
      .organization.rotateJoinQr({ organizationId: org.id, role: "mentor" });

    await expect(
      h.caller(scanner.id).organization.joinWithQr({ code: qr.code }),
    ).resolves.toMatchObject({ role: "mentor" });
  });

  it("reports an unknown token as invalid without saying more", async () => {
    const scanner = await makeUser(h.db);

    await expect(
      h.caller(scanner.id).organization.peekJoinQr({ code: "NOTAREALTOKEN" }),
    ).resolves.toEqual({ status: "invalid" });
  });
});

describeIntegration("chat authorization", () => {
  it("refuses a non-participant reading a conversation", async () => {
    // Finding #2's tRPC counterpart. The socket path was the leak; this pins the
    // read path so it cannot regress in the other direction.
    const a = await makeUser(h.db);
    const b = await makeUser(h.db);
    const outsider = await makeUser(h.db);
    const org = await makeOrganization(h.db, a.id);
    await addMember(h.db, org.id, a.id, "admin");
    await addMember(h.db, org.id, b.id, "member");
    const project = await makeProject(h.db, a.id, org.id);

    const { conversationId } = await h
      .caller(a.id)
      .chat.getOrCreateProjectConversation({ projectId: project.id, otherUserId: b.id });

    await expectForbidden(
      h.caller(outsider.id).chat.listMessages({ conversationId, limit: 10 }),
    );
  });
});

describeIntegration("unauthenticated callers", () => {
  it("cannot reach a protected procedure at all", async () => {
    await expect(
      h.caller(null).task.getByProject({ projectId: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
