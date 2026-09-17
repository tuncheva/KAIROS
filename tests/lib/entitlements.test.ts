/**
 * Plan definitions: do the two flag sets still describe the same product?
 *
 * These tests are structural rather than behavioural, because the failures this
 * seam invites are structural. Nothing is gated yet, so a mistake here does not
 * break anything today — it lies dormant until the day billing is switched on,
 * which is the worst possible day to discover that a flag was only ever added to
 * one of the two plans.
 *
 * On the division of labour with the type system: every flag on `Entitlements`
 * is required, so plainly omitting one from `FREE_ENTITLEMENTS` is a compile
 * error and needs no test. What the compiler cannot see is the case that
 * actually happens — someone marks a new flag optional (`documents?: boolean`)
 * because only Pro has a value for it yet, at which point omission compiles
 * cleanly and a free user silently reads `undefined`. That is falsy, so it looks
 * like a working paywall right up until the flag is a number or a list. The
 * key-set and defined-ness assertions exist for that path.
 *
 * The remaining assertions are pricing decisions rather than structure. They are
 * here because they were argued for in `docs/business/pricing-strategy.html` and
 * are otherwise recorded nowhere the code can check.
 */

import { describe, expect, it } from "vitest";

import {
  FREE_ENTITLEMENTS,
  PRO_ENTITLEMENTS,
  TEAM_ENTITLEMENTS,
  entitlementsForPlan,
  higherPlan,
  type Entitlements,
  type PlanId,
} from "~/lib/entitlements";

/** Every plan, so a new tier cannot be added without these checks covering it. */
const ALL_PLANS = [
  FREE_ENTITLEMENTS,
  PRO_ENTITLEMENTS,
  TEAM_ENTITLEMENTS,
] as const;

/** Flags describing features that exist in the shipped product today. */
const SHIPPED_FLAGS = [
  "scheduledAgents",
  "agentPinning",
  "undoApply",
  "toolInspector",
  "customTools",
  "perAgentMemory",
] as const satisfies readonly (keyof Entitlements)[];

describe("plan definitions", () => {
  it("describes every plan with exactly the same set of flags", () => {
    const reference = Object.keys(FREE_ENTITLEMENTS).sort();
    for (const plan of ALL_PLANS) {
      expect(Object.keys(plan).sort(), plan.plan).toEqual(reference);
    }
  });

  it("never leaves a flag undefined on either plan", () => {
    // Distinct from the key-set check: a key can be present and explicitly
    // undefined, which reads as "not granted" for booleans and as a crash for
    // anything else.
    for (const plan of ALL_PLANS) {
      for (const [flag, value] of Object.entries(plan)) {
        expect(value, `${plan.plan}.${flag}`).toBeDefined();
      }
    }
  });

  it("grants every shipped capability to Pro", () => {
    for (const flag of SHIPPED_FLAGS) {
      expect(PRO_ENTITLEMENTS[flag], flag).toBe(true);
    }
  });

  it("gives Pro a strictly larger request ceiling than Free", () => {
    expect(PRO_ENTITLEMENTS.aiRequestsPerDay).toBeGreaterThan(
      FREE_ENTITLEMENTS.aiRequestsPerDay,
    );
  });

  it("retains Free history for a bounded period and Pro history forever", () => {
    // `null` is the sentinel for unlimited. A large number would also work until
    // someone compares it with `<` and quietly culls a paying user's history.
    expect(FREE_ENTITLEMENTS.historyDays).toBeGreaterThan(0);
    expect(PRO_ENTITLEMENTS.historyDays).toBeNull();
  });

  it("offers Free a real export path rather than none", () => {
    // The pricing decision, pinned: a fully paywalled export reads as
    // hostage-taking. Free exports its tasks; Pro exports everything.
    expect(FREE_ENTITLEMENTS.exportFormats).toContain("csv");
    expect(PRO_ENTITLEMENTS.exportFormats.length).toBeGreaterThan(
      FREE_ENTITLEMENTS.exportFormats.length,
    );
  });

  it("resolves each plan id to the matching flag set", () => {
    expect(entitlementsForPlan("free")).toBe(FREE_ENTITLEMENTS);
    expect(entitlementsForPlan("pro")).toBe(PRO_ENTITLEMENTS);
    expect(entitlementsForPlan("team")).toBe(TEAM_ENTITLEMENTS);
    expect(entitlementsForPlan("free").plan).toBe("free");
    expect(entitlementsForPlan("pro").plan).toBe("pro");
    expect(entitlementsForPlan("team").plan).toBe("team");
  });
});

/**
 * Team is Pro plus organization features, and the "plus" has to be total.
 *
 * The failure this guards against is silent and expensive: Pro gains a flag,
 * Team is a hand-written literal that nobody updates, and the more expensive
 * plan offers less than the cheaper one. `TEAM_ENTITLEMENTS` spreads Pro
 * precisely so that cannot happen — these assertions are what notice if someone
 * "tidies" the spread away into an explicit object.
 */
describe("Team relative to Pro", () => {
  /** The flags that are the Pro/Team boundary. */
  const ORG_FLAGS = [
    "orgAdminAgent",
    "sharedOrgMemory",
    "orgWideRiskRadar",
    "auditTrail",
    "priorityModel",
  ] as const satisfies readonly (keyof Entitlements)[];

  it("grants Team every boolean flag Pro has", () => {
    for (const [flag, value] of Object.entries(PRO_ENTITLEMENTS)) {
      if (typeof value !== "boolean" || !value) continue;
      expect(
        TEAM_ENTITLEMENTS[flag as keyof Entitlements],
        `team.${flag} must not be less than pro.${flag}`,
      ).toBe(true);
    }
  });

  it("never gives Team a smaller numeric ceiling than Pro", () => {
    expect(TEAM_ENTITLEMENTS.aiRequestsPerDay).toBeGreaterThanOrEqual(
      PRO_ENTITLEMENTS.aiRequestsPerDay,
    );
    expect(TEAM_ENTITLEMENTS.maxSchedules).toBeGreaterThanOrEqual(
      PRO_ENTITLEMENTS.maxSchedules,
    );
    // `null` is unlimited, so Pro's null must not become a number on Team.
    if (PRO_ENTITLEMENTS.historyDays === null) {
      expect(TEAM_ENTITLEMENTS.historyDays).toBeNull();
    }
  });

  it("reserves the organization flags for Team alone", () => {
    for (const flag of ORG_FLAGS) {
      expect(FREE_ENTITLEMENTS[flag], `free.${flag}`).toBe(false);
      expect(PRO_ENTITLEMENTS[flag], `pro.${flag}`).toBe(false);
      expect(TEAM_ENTITLEMENTS[flag], `team.${flag}`).toBe(true);
    }
  });
});

/**
 * `higherPlan` decides what someone covered twice actually gets.
 *
 * It is the only place the tiers are ordered, and getting it wrong is not
 * visible in the UI — a Team member with a lapsed personal Pro would simply find
 * features missing, with nothing on screen explaining why.
 */
describe("higherPlan", () => {
  const PLANS: readonly PlanId[] = ["free", "pro", "team"];

  it("is commutative", () => {
    for (const a of PLANS) {
      for (const b of PLANS) {
        expect(higherPlan(a, b), `${a} vs ${b}`).toBe(higherPlan(b, a));
      }
    }
  });

  it("never returns a plan that was not offered", () => {
    for (const a of PLANS) {
      for (const b of PLANS) {
        expect([a, b]).toContain(higherPlan(a, b));
      }
    }
  });

  it("prefers the more generous tier", () => {
    expect(higherPlan("free", "pro")).toBe("pro");
    expect(higherPlan("pro", "team")).toBe("team");
    expect(higherPlan("free", "team")).toBe("team");
  });

  it("is idempotent", () => {
    for (const plan of PLANS) {
      expect(higherPlan(plan, plan)).toBe(plan);
    }
  });

  it("keeps a personal Pro when the active org is unpaid", () => {
    // The case that motivated taking a maximum rather than letting the org win:
    // joining a Free organization must not cancel the plan you pay for.
    expect(higherPlan("pro", "free")).toBe("pro");
  });
});
