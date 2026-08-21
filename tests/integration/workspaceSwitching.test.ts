import { beforeAll, afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";

import {
  addMember,
  createHarness,
  describeIntegration,
  makeOrganization,
  makeUser,
  type Harness,
} from "./harness";

/**
 * Moving between workspaces, executed against a real database.
 *
 * Two bugs live here, and neither is visible to a test that reads the source:
 *
 *  - `getActive` ignored `usageMode` and fell back to "whichever membership the
 *    database returns first", so `setPersonalMode` was undone by the very next
 *    read. Personal workspace was reachable at onboarding and never again.
 *  - that same fallback ran `limit(1)` with no `ORDER BY`, so which organisation
 *    a user landed in was up to the query planner.
 */

let h: Harness;

beforeAll(async () => {
  h = await createHarness("workspace");
}, 120_000);

afterAll(async () => {
  await h?.cleanup();
});

/** A user in two organisations, active in the first. */
async function seedTwoOrgs() {
  const user = await makeUser(h.db, { usageMode: "organization" });
  const first = await makeOrganization(h.db, user.id);
  const second = await makeOrganization(h.db, user.id);
  await addMember(h.db, first.id, user.id, "admin");
  await addMember(h.db, second.id, user.id, "member");

  await h.db
    .update(schema.users)
    .set({ activeOrganizationId: first.id })
    .where(eq(schema.users.id, user.id));

  return { user, first, second };
}

describeIntegration("switching between organizations", () => {
  it("switches there and back again", async () => {
    const { user, first, second } = await seedTwoOrgs();
    const caller = h.caller(user.id);

    expect((await caller.organization.getActive())?.organization.id).toBe(first.id);

    await caller.organization.setActive({ organizationId: second.id });
    expect((await caller.organization.getActive())?.organization.id).toBe(second.id);

    // The half that was reported broken: getting back out again.
    await caller.organization.setActive({ organizationId: first.id });
    expect((await caller.organization.getActive())?.organization.id).toBe(first.id);
  });

  it("refuses an organization the caller does not belong to", async () => {
    const { user } = await seedTwoOrgs();
    const outsider = await makeUser(h.db);
    const theirs = await makeOrganization(h.db, outsider.id);
    await addMember(h.db, theirs.id, outsider.id, "admin");

    await expect(
      h.caller(user.id).organization.setActive({ organizationId: theirs.id }),
    ).rejects.toThrow(/not a member/i);
  });
});

describeIntegration("switching to the personal workspace", () => {
  it("stays personal once chosen, even with memberships", async () => {
    const { user, first } = await seedTwoOrgs();
    const caller = h.caller(user.id);

    expect((await caller.organization.getActive())?.organization.id).toBe(first.id);

    await caller.user.setPersonalMode();

    // Before the fix this returned `first` again: `getActive` read a null
    // `activeOrganizationId` as "not chosen yet" rather than "chose personal",
    // and fell through to the membership fallback.
    expect(await caller.organization.getActive()).toBeNull();
  });

  it("clears the organization off the profile too", async () => {
    const { user } = await seedTwoOrgs();
    const caller = h.caller(user.id);

    await caller.user.setPersonalMode();
    // `getProfile` is nullable for a missing user row; the fixture has one.
    const profile = (await caller.user.getProfile())!;

    expect(profile.usageMode).toBe("personal");
    expect(profile.organization).toBeNull();
    expect(profile.role).toBeNull();
    // The memberships themselves survive — going personal is not leaving.
    expect(profile.organizations).toHaveLength(2);
  });

  it("lets you come back into an organization afterwards", async () => {
    const { user, second } = await seedTwoOrgs();
    const caller = h.caller(user.id);

    await caller.user.setPersonalMode();
    await caller.organization.setActive({ organizationId: second.id });

    const active = await caller.organization.getActive();
    expect(active?.organization.id).toBe(second.id);

    const profile = (await caller.user.getProfile())!;
    expect(profile.usageMode).toBe("organization");
  });
});

describeIntegration("no active organization recorded", () => {
  it("falls back to the earliest membership", async () => {
    // Never switched, never onboarded into personal: the fallback picks for
    // them. Which one it picks has to be a rule, not whatever the planner felt
    // like returning from an unordered `limit(1)` — pinning it to "the one you
    // joined first" is what makes the workspace name stop moving on its own.
    const user = await makeUser(h.db);
    const joinedFirst = await makeOrganization(h.db, user.id);
    const joinedSecond = await makeOrganization(h.db, user.id);
    const joinedThird = await makeOrganization(h.db, user.id);
    await addMember(h.db, joinedFirst.id, user.id, "member");
    await addMember(h.db, joinedSecond.id, user.id, "admin");
    await addMember(h.db, joinedThird.id, user.id, "member");

    const caller = h.caller(user.id);
    const answers = await Promise.all([
      caller.organization.getActive(),
      caller.organization.getActive(),
      caller.organization.getActive(),
    ]);

    for (const answer of answers) {
      expect(answer?.organization.id).toBe(joinedFirst.id);
    }
  });

  it("returns null for someone in no organization at all", async () => {
    const loner = await makeUser(h.db);
    expect(await h.caller(loner.id).organization.getActive()).toBeNull();
  });
});
