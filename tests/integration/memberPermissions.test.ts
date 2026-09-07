import { beforeAll, afterAll, it, expect } from "vitest";

import {
  createHarness,
  describeIntegration,
  makeUser,
  makeOrganization,
  addMember,
  type Harness,
} from "./harness";

/**
 * `organization.updateMemberPermissions`, which had no caller.
 *
 * The roster now renders toggles for the two flags it accepts, driven by the
 * flags `getMembers` reports. Both halves are pinned here: the read has to
 * reflect the write, or a toggle shows one thing and saves another.
 *
 * The input requires *both* flags on every call, so the client has to send the
 * untouched one at its current value. That is the easiest thing to get wrong and
 * the most damaging — flipping one permission would silently clear the other.
 */
describeIntegration("member permissions", () => {
  let h: Harness;
  let adminId: string;
  let memberId: string;
  let orgId: number;

  beforeAll(async () => {
    h = await createHarness("memberperms");

    const admin = await makeUser(h.db, { name: "Admin" });
    const member = await makeUser(h.db, { name: "Member" });
    adminId = admin.id;
    memberId = member.id;

    const org = await makeOrganization(h.db, adminId);
    orgId = org.id;

    await addMember(h.db, orgId, adminId, "admin");
    await addMember(h.db, orgId, memberId, "member");
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  async function flagsFor(userId: string) {
    const members = await h
      .caller(adminId)
      .organization.getMembers({ organizationId: orgId });
    const row = members.find((m) => m.id === userId);
    return {
      canAddMembers: row?.canAddMembers,
      canAssignTasks: row?.canAssignTasks,
    };
  }

  it("reports the flags the toggles are drawn from", async () => {
    const flags = await flagsFor(memberId);

    // Present and boolean — a toggle cannot render from an absent field.
    expect(typeof flags.canAddMembers).toBe("boolean");
    expect(typeof flags.canAssignTasks).toBe("boolean");
  });

  it("writes one flag without clearing the other", async () => {
    const before = await flagsFor(memberId);

    await h.caller(adminId).organization.updateMemberPermissions({
      organizationId: orgId,
      userId: memberId,
      canAddMembers: true,
      // Carried at its current value, exactly as the roster does.
      canAssignTasks: before.canAssignTasks ?? false,
    });

    const after = await flagsFor(memberId);
    expect(after.canAddMembers).toBe(true);
    expect(after.canAssignTasks).toBe(before.canAssignTasks);
  });

  it("round-trips a flag back off", async () => {
    await h.caller(adminId).organization.updateMemberPermissions({
      organizationId: orgId,
      userId: memberId,
      canAddMembers: false,
      canAssignTasks: true,
    });

    expect(await flagsFor(memberId)).toEqual({
      canAddMembers: false,
      canAssignTasks: true,
    });
  });

  it("refuses an admin editing their own permissions", async () => {
    // Why the roster omits the toggles on your own row rather than showing
    // controls that always fail.
    await expect(
      h.caller(adminId).organization.updateMemberPermissions({
        organizationId: orgId,
        userId: adminId,
        canAddMembers: false,
        canAssignTasks: false,
      }),
    ).rejects.toThrow();
  });

  it("refuses a non-admin entirely", async () => {
    await expect(
      h.caller(memberId).organization.updateMemberPermissions({
        organizationId: orgId,
        userId: adminId,
        canAddMembers: true,
        canAssignTasks: true,
      }),
    ).rejects.toThrow();
  });
});
