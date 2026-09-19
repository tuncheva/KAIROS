import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  FREE_ENTITLEMENTS,
  PRO_ENTITLEMENTS,
  TEAM_ENTITLEMENTS,
  type Entitlements,
} from "~/lib/entitlements";

/**
 * Every paid flag is read by something on the server.
 *
 * The failure this exists to catch is silent and expensive, and the codebase had
 * four instances of it at once: a flag is defined in `Entitlements`, granted to
 * Pro, printed on the pricing page as a bullet a customer pays for — and read by
 * no server code at all. `undoApply` and `agentPinning` were in exactly that
 * state, gated in neither the client nor the server; `perAgentMemory` and
 * `standingInstructions` chose their limit from a scope name the caller supplied.
 * Nothing failed. The feature simply worked for everyone, and the only way to
 * discover it was to read the flag's call sites and find none.
 *
 * A type cannot catch this: `Entitlements` is a complete object either way, and
 * an unread property is exactly as valid as a read one. So the check is a scan
 * of the server sources for the flag's name.
 *
 * ## The allowlist is the point
 *
 * {@link NOT_YET_ENFORCED} names the flags that are deliberately unread, which
 * is the honest state for the roadmap half of `Entitlements` — those features do
 * not exist yet, and a gate on a feature nobody has built is a gate on nothing.
 * `lib/entitlements` explains why the flags are written ahead of their features.
 *
 * What this buys is that shipping one of them has to touch this list. The paywall
 * argument then happens in the feature's own PR, deliberately, instead of being
 * decided by omission — which is how all four of the above became free.
 */

const SERVER_ROOTS = ["src/server", "src/app/api"];

/**
 * Flags with no server-side enforcement, and why that is currently correct.
 *
 * Remove an entry when its feature ships. If a flag is here and its feature is
 * live, the feature is free.
 */
const NOT_YET_ENFORCED: Partial<Record<keyof Entitlements, string>> = {
  // Gated by `maxSchedules: 0` on Free instead — a user who cannot create a
  // schedule cannot have one run. Enforcing the boolean as well would be a
  // second rule that has to agree with the first.
  scheduledAgents: "enforced via maxSchedules",

  // Roadmap — see `lib/entitlements`. Nothing reads these because nothing
  // implements them.
  toolInspector: "not built",
  customTools: "not built",
  emailDelivery: "not built",
  planDiff: "not built",
  orgAdminAgent: "not built",
  sharedOrgMemory: "not built",
  orgWideRiskRadar: "not built",
  auditTrail: "not built",
  priorityModel: "not built",
};

function sourceFiles(root: string): string[] {
  const abs = path.resolve(__dirname, "../..", root);
  if (!fs.existsSync(abs)) return [];

  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(abs);
  return out;
}

const serverSource = SERVER_ROOTS.flatMap(sourceFiles)
  // The definitions themselves are not enforcement: `lib/entitlements` naming a
  // flag proves nothing, and neither does the billing module that returns the
  // whole set. Only `src/server` and `src/app/api` are scanned for that reason,
  // and the flag-set plumbing inside them is excluded here.
  .filter((file) => !file.endsWith(path.join("billing", "entitlements.ts")))
  .map((file) => fs.readFileSync(file, "utf-8"))
  .join("\n");

/** Every flag whose value is a plain boolean, read off the real Free object. */
const booleanFlags = (Object.keys(FREE_ENTITLEMENTS) as (keyof Entitlements)[]).filter(
  (flag) => typeof FREE_ENTITLEMENTS[flag] === "boolean",
);

/** A flag only needs a gate if some plan actually withholds it. */
function isPaid(flag: keyof Entitlements): boolean {
  return FREE_ENTITLEMENTS[flag] === false;
}

describe("entitlement enforcement", () => {
  it("finds the boolean flags to check", () => {
    // Guards the scan itself: a rename that emptied this list would make every
    // assertion below pass vacuously.
    expect(booleanFlags.length).toBeGreaterThan(10);
    expect(booleanFlags).toContain("undoApply");
    expect(booleanFlags).toContain("agentPinning");
  });

  it("reads some server source", () => {
    expect(serverSource.length).toBeGreaterThan(10_000);
  });

  it.each(booleanFlags.filter(isPaid).filter((f) => !(f in NOT_YET_ENFORCED)))(
    "%s is read by the server",
    (flag) => {
      expect(
        serverSource.includes(`.${flag}`) || serverSource.includes(`"${flag}"`),
      ).toBe(true);
    },
  );

  it("does not excuse a flag that Free already grants", () => {
    // An entry here for a flag every plan has would be permanently unfalsifiable
    // — it can never become a leak, so it should not be on a list of accepted
    // ones, where it would only obscure the entries that matter.
    for (const flag of Object.keys(NOT_YET_ENFORCED) as (keyof Entitlements)[]) {
      expect(isPaid(flag), `${flag} is granted to Free; drop it from the list`).toBe(
        true,
      );
    }
  });

  it("does not excuse a flag that is in fact enforced", () => {
    // Keeps the list honest in the other direction: an entry that has quietly
    // acquired a gate is a stale comment claiming the feature is free.
    for (const flag of Object.keys(NOT_YET_ENFORCED) as (keyof Entitlements)[]) {
      if (flag === "scheduledAgents") continue; // documented as gated by proxy
      expect(serverSource.includes(`.${flag}`), `${flag} now has a gate`).toBe(false);
    }
  });
});

describe("the flags the audit closed", () => {
  // Named individually rather than left to the scan above, because these four
  // are the regression: each was sold on the pricing page and reachable without
  // paying, and a future refactor that drops the gate should fail loudly here
  // rather than move the flag onto the allowlist.
  it.each(["undoApply", "agentPinning", "perAgentMemory", "standingInstructions"])(
    "%s is still gated",
    (flag) => {
      expect(serverSource.includes(`.${flag}`)).toBe(true);
    },
  );

  it("withholds all four from Free and grants them to Pro and Team", () => {
    for (const flag of [
      "undoApply",
      "agentPinning",
      "perAgentMemory",
      "standingInstructions",
    ] as const) {
      expect(FREE_ENTITLEMENTS[flag]).toBe(false);
      expect(PRO_ENTITLEMENTS[flag]).toBe(true);
      expect(TEAM_ENTITLEMENTS[flag]).toBe(true);
    }
  });
});
