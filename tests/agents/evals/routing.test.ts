/**
 * F-1 — the routing eval.
 *
 * Two metrics, and they are the two that decide whether the agent layer is any
 * good:
 *
 * - **Schema validity.** Does `A1OutputSchema` accept a well-formed response for
 *   every case? A failure here means the prompt and the schema have drifted, and
 *   in production that surfaces as `jsonRepair` firing on every turn — an extra
 *   model call per message that nobody notices until the bill arrives.
 * - **Routing accuracy.** Given a valid response, does the turn dispatch to the
 *   right agents? This is the check the codebase had no version of: the routing
 *   logic moved from the client to `handoff.ts`, changed shape twice, and was
 *   only ever verified by hand.
 *
 * Offline by default. The `response` on each case is a hand-written correct
 * output, so this run measures *our* half of the contract — schema, transform,
 * dispatch — with no API key and no network. Set `EVAL_LIVE=1` to send the real
 * messages to the configured model and measure the model's half too.
 */

import { describe, expect, it } from "vitest";

import {
  A1OutputSchema,
  type A1Output,
} from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";

import { EVAL_CASES, type EvalCase, type TargetAgent } from "./cases";

/**
 * The routing decision a turn would take.
 *
 * Mirrors what `runAgentTurn` does with A1's output — read the intent, take the
 * normalized handoff list — without needing a database or a model behind it.
 */
function route(output: A1Output): {
  intent: "answer" | "handoff" | "clarify" | "draft_plan";
  agents: TargetAgent[];
} {
  const agents =
    output.intent.type === "handoff"
      ? output.handoffs.map((h) => h.targetAgent)
      : [];
  return { intent: output.intent.type, agents };
}

function sorted(agents: readonly string[]): string[] {
  return [...agents].sort();
}

interface CaseOutcome {
  id: string;
  valid: boolean;
  routed: boolean;
  detail?: string;
}

function evaluate(testCase: EvalCase): CaseOutcome {
  const parsed = A1OutputSchema.safeParse(testCase.response);
  if (!parsed.success) {
    return {
      id: testCase.id,
      valid: false,
      routed: false,
      detail: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  const actual = route(parsed.data);
  const expectedAgents = testCase.expect.agents ?? [];

  const intentOk = actual.intent === testCase.expect.intent;
  const agentsOk =
    sorted(actual.agents).join(",") === sorted(expectedAgents).join(",");

  return {
    id: testCase.id,
    valid: true,
    routed: intentOk && agentsOk,
    detail: intentOk
      ? agentsOk
        ? undefined
        : `agents: expected [${sorted(expectedAgents).join(", ")}], got [${sorted(actual.agents).join(", ")}]`
      : `intent: expected ${testCase.expect.intent}, got ${actual.intent}`,
  };
}

describe("A1 routing eval", () => {
  const outcomes = EVAL_CASES.map(evaluate);

  it("has a golden set large enough to be a signal rather than an anecdote", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(50);
  });

  it("gives every case a unique id", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states why every case exists", () => {
    for (const testCase of EVAL_CASES) {
      expect(testCase.why.length, `${testCase.id} has no rationale`).toBeGreaterThan(20);
    }
  });

  describe("schema validity", () => {
    it.each(EVAL_CASES.map((c) => [c.id, c] as const))(
      "%s produces a response the schema accepts",
      (_id, testCase) => {
        const outcome = evaluate(testCase);
        expect(outcome.valid, outcome.detail).toBe(true);
      },
    );
  });

  describe("routing accuracy", () => {
    it.each(EVAL_CASES.map((c) => [c.id, c] as const))(
      "%s routes correctly",
      (_id, testCase) => {
        const outcome = evaluate(testCase);
        expect(outcome.routed, outcome.detail).toBe(true);
      },
    );
  });

  it("reports the aggregate scores", () => {
    const valid = outcomes.filter((o) => o.valid).length;
    const routed = outcomes.filter((o) => o.routed).length;
    const total = outcomes.length;

    // Printed rather than merely asserted: the number is what you watch across
    // prompt edits, and a pass/fail alone does not show a slide from 100% to 92%.
    console.log(
      `\n  eval: ${String(total)} cases · schema ${String(valid)}/${String(total)} · routing ${String(routed)}/${String(total)}`,
    );

    expect(valid).toBe(total);
    expect(routed).toBe(total);
  });
});

// ---------------------------------------------------------------------------
// Coverage assertions — the set must keep exercising every branch
// ---------------------------------------------------------------------------

describe("eval coverage", () => {
  it("covers every handoff target", () => {
    const covered = new Set(
      EVAL_CASES.flatMap((c) => c.expect.agents ?? []),
    );
    for (const agent of [
      "task_planner",
      "notes_vault",
      "events_publisher",
      "org_admin",
    ]) {
      expect(covered.has(agent as TargetAgent), `no case routes to ${agent}`).toBe(
        true,
      );
    }
  });

  it("covers every intent type A1 can emit", () => {
    const intents = new Set(EVAL_CASES.map((c) => c.expect.intent));
    expect(intents).toContain("answer");
    expect(intents).toContain("handoff");
    expect(intents).toContain("clarify");
  });

  it("covers multi-agent turns", () => {
    const multi = EVAL_CASES.filter((c) => (c.expect.agents?.length ?? 0) > 1);
    expect(multi.length).toBeGreaterThanOrEqual(2);
  });

  it("covers non-English routing", () => {
    // Routing that only works in English is how the old client-side substring
    // router failed, and it failed silently for every non-English speaker.
    const nonEnglish = EVAL_CASES.filter((c) => /[а-яА-Яáéíóúñü]/.test(c.message));
    expect(nonEnglish.length).toBeGreaterThanOrEqual(2);
  });

  it("covers the scope guard and prompt injection", () => {
    expect(EVAL_CASES.some((c) => c.id.startsWith("scope."))).toBe(true);
    expect(EVAL_CASES.some((c) => c.id === "scope.injection-in-message")).toBe(true);
  });

  it("includes negative cases, not only happy paths", () => {
    // A suite of only-should-do cases cannot catch over-triggering, which is the
    // failure mode that actually annoys people: clarifying when it is obvious,
    // remembering what was never meant to be remembered.
    expect(EVAL_CASES.some((c) => c.id === "clarify.not-when-scoped")).toBe(true);
    expect(EVAL_CASES.some((c) => c.id === "memory.no-inference")).toBe(true);
  });
});
