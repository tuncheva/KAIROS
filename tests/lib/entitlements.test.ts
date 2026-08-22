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
  entitlementsForPlan,
  type Entitlements,
} from "~/lib/entitlements";

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
  it("describes both plans with exactly the same set of flags", () => {
    expect(Object.keys(FREE_ENTITLEMENTS).sort()).toEqual(
      Object.keys(PRO_ENTITLEMENTS).sort(),
    );
  });

  it("never leaves a flag undefined on either plan", () => {
    // Distinct from the key-set check: a key can be present and explicitly
    // undefined, which reads as "not granted" for booleans and as a crash for
    // anything else.
    for (const plan of [FREE_ENTITLEMENTS, PRO_ENTITLEMENTS]) {
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
    expect(entitlementsForPlan("free").plan).toBe("free");
    expect(entitlementsForPlan("pro").plan).toBe("pro");
  });
});
