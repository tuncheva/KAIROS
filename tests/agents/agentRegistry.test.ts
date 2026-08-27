/**
 * The agent registry, and the contract that makes pinning safe.
 *
 * The registry is the list the picker renders and the inspector describes. Two
 * properties matter more than its contents:
 *
 * - **Pinnable ⊆ dispatchable.** A pinned id is handed to `runHandoff`, whose
 *   switch is exhaustive over `TargetAgent` rather than defensive. If those two
 *   sets ever diverge, a pin falls through the switch and the turn returns
 *   undefined instead of a plan.
 * - **Tools are not invented.** Only A1 runs a tool loop. Listing tools against
 *   an agent that has none would describe a mechanism that does not exist, which
 *   is worse than saying nothing.
 */

import { describe, expect, it } from "vitest";

import {
  AGENTS,
  HANDOFF_TARGETS,
  getAgent,
  isPinnable,
} from "~/server/llm/agents/registry";
import { TargetAgentSchema } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import { a1WorkspaceConciergeProfile } from "~/server/llm/profiles/a1WorkspaceConcierge";

describe("agent registry", () => {
  it("has a unique id for every agent", () => {
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists every agent A1 can hand off to", () => {
    for (const target of TargetAgentSchema.options) {
      expect(getAgent(target), `${target} is missing from the registry`).toBeDefined();
    }
  });

  it("derives its handoff targets from A1's own output schema", () => {
    // Not a restatement — if the schema gains a target, this list gains it too,
    // which is the point of deriving rather than hardcoding.
    expect([...HANDOFF_TARGETS]).toEqual([...TargetAgentSchema.options]);
  });

  it("takes A1's tool list from the profile the model is actually given", () => {
    const a1 = getAgent("workspace_concierge");
    expect(a1?.tools).toEqual(a1WorkspaceConciergeProfile.draftToolAllowlist);
  });

  it("claims no tools for agents that never run a tool loop", () => {
    for (const agent of AGENTS) {
      if (agent.id === "workspace_concierge") continue;
      expect(agent.tools, `${agent.id} should hold no tools`).toEqual([]);
    }
  });

  it("gives every write agent something it can actually change", () => {
    for (const agent of AGENTS.filter((a) => a.writes)) {
      expect(agent.operations.length, `${agent.id} writes but lists no operations`)
        .toBeGreaterThan(0);
    }
  });

  it("never marks a scheduled agent as a write agent", () => {
    // The scheduled pair report and detect; neither applies anything, and
    // showing them with a "needs approval" affordance would be a lie.
    for (const agent of AGENTS.filter((a) => a.kind === "scheduled")) {
      expect(agent.writes).toBe(false);
    }
  });
});

describe("isPinnable", () => {
  it("accepts exactly the agents runHandoff can dispatch", () => {
    const pinnable = AGENTS.filter((a) => isPinnable(a.id)).map((a) => a.id);
    expect(pinnable.sort()).toEqual([...TargetAgentSchema.options].sort());
  });

  it("rejects A1, because pinning it is what Auto already means", () => {
    expect(isPinnable("workspace_concierge")).toBe(false);
  });

  it("rejects the scheduled agents, which have no chat surface", () => {
    expect(isPinnable("daily_brief")).toBe(false);
    expect(isPinnable("risk_radar")).toBe(false);
  });

  it("rejects anything unknown", () => {
    // The route falls back to Auto on a false here rather than 400-ing, so this
    // is the check standing between a client string and the dispatch switch.
    expect(isPinnable("")).toBe(false);
    expect(isPinnable("__proto__")).toBe(false);
    expect(isPinnable("task_planner; drop table")).toBe(false);
  });
});
