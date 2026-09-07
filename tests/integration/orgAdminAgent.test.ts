import { beforeAll, afterAll, it, expect } from "vitest";

import {
  createHarness,
  describeIntegration,
  makeUser,
  makeOrganization,
  addMember,
  type Harness,
} from "./harness";
import { organizationMembers } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * A5 (org admin) end to end, against the real LLM endpoint.
 *
 * ## Why this file exists
 *
 * `agent.orgAdminConfirm` and `agent.orgAdminApply` had no caller anywhere in
 * the client, and the chat's plan renderer had no `kind: "org"` branch — it fell
 * through and read an org plan through the event plan's field names. So the two
 * procedures below had never been executed by anything: not by the UI, and not
 * by a test. `ProjectIntelligenceChat.test.tsx` now covers the rendering with a
 * mocked stream; this covers the half that actually writes to the database.
 *
 * ## Why it is safe to apply real mutations
 *
 * `createHarness` provisions a throwaway schema, runs the migrations into it and
 * pins `search_path` there, so the role change asserted below happens to a
 * fixture member in a schema that is dropped in teardown. Nothing in `public` is
 * touched. See `harness.ts`.
 *
 * ## Why it skips without a key
 *
 * These call a real model. `LLM_API_KEY` absent means the checkout is not
 * configured for the AI, and a hard failure there would be reporting a missing
 * local secret as a broken build.
 */
const hasLlm = Boolean(
  (process.env.LLM_API_KEY ?? process.env.LLM_API_KEY_NVIDIA ?? "").trim(),
);

/**
 * Generous, because the endpoint is the slow part and its latency is not steady.
 *
 * A draft has been observed at 14s and at over 180s against the same model on
 * the same day. A tight bound here does not catch a regression; it just fails
 * the build on a slow afternoon, which teaches everyone to re-run rather than
 * to read.
 */
const LIVE_TIMEOUT_MS = 300_000;

describeIntegration("A5 org admin — live", () => {
  let h: Harness;
  let ownerId: string;
  let memberId: string;
  let orgId: number;

  beforeAll(async () => {
    h = await createHarness("orgagent");

    const owner = await makeUser(h.db, { name: "Teodora Owner" });
    const member = await makeUser(h.db, { name: "Ivan Petrov" });
    ownerId = owner.id;
    memberId = member.id;

    const org = await makeOrganization(h.db, ownerId);
    orgId = org.id;

    await addMember(h.db, orgId, ownerId, "admin");
    await addMember(h.db, orgId, memberId, "member");
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it.runIf(hasLlm)(
    "drafts a role change, then confirm + apply writes it",
    async () => {
      const caller = h.caller(ownerId);

      const draft = await caller.agent.orgAdminDraft({
        message: "Promote Ivan Petrov to admin of this organization.",
        organizationId: orgId,
      });

      expect(draft.draftId).toBeTruthy();

      // The model decides the shape of the plan, so this asserts the contract
      // the UI depends on — not a particular sentence. A plan that asks a
      // question instead of acting is a legitimate A5 answer, and the chat
      // renders it as one, so it is not a failure here either.
      const askedInstead = draft.plan.questions.length > 0;
      if (askedInstead) {
        expect(draft.plan.roleChanges).toHaveLength(0);
        return;
      }

      expect(draft.plan.roleChanges.length).toBeGreaterThan(0);
      const change = draft.plan.roleChanges[0]!;
      expect(change.targetUserId).toBe(memberId);
      expect(change.newRole).toBe("admin");
      // Every A5 operation carries a rationale, because the confirm card shows
      // one. A plan without it renders an empty line in the UI.
      expect(change.rationale.length).toBeGreaterThan(0);
      expect(change.targetName.length).toBeGreaterThan(0);

      const confirmed = await caller.agent.orgAdminConfirm({
        draftId: draft.draftId,
      });
      expect(confirmed.confirmationToken).toBeTruthy();
      expect(confirmed.summary.roleChanges).toBeGreaterThan(0);

      const applied = await caller.agent.orgAdminApply({
        draftId: draft.draftId,
        confirmationToken: confirmed.confirmationToken,
      });
      expect(applied.applied).toBe(true);
      expect(applied.results.rolesChanged).toBeGreaterThan(0);

      const [row] = await h.db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            eq(organizationMembers.userId, memberId),
          ),
        );

      expect(row?.role).toBe("admin");
    },
    LIVE_TIMEOUT_MS,
  );

  it.runIf(hasLlm)(
    "refuses a confirmation token issued for a different user",
    async () => {
      const draft = await h.caller(ownerId).agent.orgAdminDraft({
        message: "Remove Ivan Petrov from the organization.",
        organizationId: orgId,
      });

      const confirmed = await h
        .caller(ownerId)
        .agent.orgAdminConfirm({ draftId: draft.draftId });

      // The token is bound to the user who confirmed. A member replaying it
      // must not be able to execute an admin's approved plan.
      await expect(
        h.caller(memberId).agent.orgAdminApply({
          draftId: draft.draftId,
          confirmationToken: confirmed.confirmationToken,
        }),
      ).rejects.toThrow();
    },
    LIVE_TIMEOUT_MS,
  );
});
