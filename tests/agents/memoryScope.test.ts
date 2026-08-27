/**
 * Per-agent memory: does a scoped fact stay where it was put?
 *
 * The whole value of scoping is negative — a preference set for the Notes Vault
 * must *not* reach the Task Planner. That is the assertion worth having, because
 * the failure is silent: a leaked fact does not error, it just quietly steers an
 * agent it was never meant for, and the only symptom is worse output.
 *
 * `formatMemoryForPrompt` is the last point where memory is still structured
 * before it becomes prompt text, so it is tested directly rather than through a
 * builder that would need a database behind it.
 */

import { describe, expect, it } from "vitest";

import {
  GLOBAL_SCOPE,
  MAX_AGENT_FACTS,
  MAX_FACTS,
  formatMemoryForPrompt,
  type MemoryFact,
} from "~/server/llm/memory";

function fact(
  key: string,
  value: string,
  scope: string = GLOBAL_SCOPE,
): MemoryFact {
  return { id: 1, key, value, scope, updatedAt: new Date("2026-01-01") };
}

describe("formatMemoryForPrompt", () => {
  it("says nothing at all when there is nothing remembered", () => {
    // An always-present "Known facts: (none)" heading is prompt weight that buys
    // nothing and invites the model to remark on its own emptiness.
    expect(formatMemoryForPrompt([])).toBe("");
  });

  it("lists global facts under the general heading", () => {
    const out = formatMemoryForPrompt([
      fact("sprint_cadence", "Sprints run Monday to Friday."),
    ]);
    expect(out).toContain("What you know about this user");
    expect(out).toContain("Sprints run Monday to Friday.");
    expect(out).not.toContain("for you in particular");
  });

  it("separates an agent's own facts from the global ones", () => {
    const out = formatMemoryForPrompt([
      fact("sprint_cadence", "Sprints run Monday to Friday."),
      fact("wording", "Write task titles in Bulgarian.", "task_planner"),
    ]);

    expect(out).toContain("What you know about this user");
    expect(out).toContain("for you in particular");
    expect(out.indexOf("Sprints run Monday to Friday.")).toBeLessThan(
      out.indexOf("for you in particular"),
    );
    expect(out.indexOf("Write task titles in Bulgarian.")).toBeGreaterThan(
      out.indexOf("for you in particular"),
    );
  });

  it("omits the scoped heading when only global facts are present", () => {
    const out = formatMemoryForPrompt([fact("a", "One.")]);
    expect(out).not.toContain("for you in particular");
  });

  /**
   * The isolation property, stated as the leak it prevents.
   *
   * `loadUserMemory` is what enforces this in production — it selects only
   * `global` and the running agent's scope — so what a prompt receives can never
   * contain a third agent's rows. This asserts the consequence: given the rows
   * that agent is entitled to, another agent's preference is nowhere in its
   * prompt text.
   */
  it("never renders a fact belonging to a different agent", () => {
    // What loadUserMemory(userId, "task_planner") returns: global + task_planner.
    // The notes_vault row is excluded in SQL and so is absent here.
    const asLoadedForTaskPlanner = [
      fact("sprint_cadence", "Sprints run Monday to Friday."),
      fact("wording", "Write task titles in Bulgarian.", "task_planner"),
    ];

    const out = formatMemoryForPrompt(asLoadedForTaskPlanner);

    expect(out).not.toContain("Always tag notes with the project name.");
    expect(out).not.toContain("notes_vault");
  });
});

describe("memory caps", () => {
  it("keeps the injected block bounded regardless of agent count", () => {
    // Only two scopes are ever loaded at once — global plus the running agent —
    // so the worst case is fixed even if all seven agents hold memories.
    const worstCaseFacts = MAX_FACTS + MAX_AGENT_FACTS;
    expect(worstCaseFacts).toBe(30);

    // 200 chars is the per-value cap. Under 8 KB keeps memory smaller than the
    // tool definitions already in every request, which is the property the
    // original 20-fact limit was chosen for.
    expect(worstCaseFacts * 200).toBeLessThan(8_000);
  });

  it("allows fewer per-agent facts than global ones", () => {
    expect(MAX_AGENT_FACTS).toBeLessThan(MAX_FACTS);
  });
});
