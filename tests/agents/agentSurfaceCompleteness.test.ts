/**
 * Every agent a user can pin must be reachable end to end.
 *
 * A6 (Project Manager) shipped with a draft path and nothing else: the
 * orchestrator had `projectManagerConfirm` and `projectManagerApply`, no tRPC
 * procedure exposed either, `agentOrchestrator` did not re-export the module at
 * all, and the chat had no branch for its plan kind. The visible symptom was the
 * chat answering "I couldn't generate a response for that" to every message put
 * to the Project Manager — a draft with nowhere to go.
 *
 * Each half of that was individually invisible. These tests are the structural
 * check that no other agent can be added the same way: the picker's list is the
 * source of truth, and every id on it has to appear in every layer.
 */

import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { HANDOFF_TARGETS } from "~/server/llm/agents/registry";

const SRC = path.resolve(__dirname, "../../src");

function read(relative: string): string {
  return fs.readFileSync(path.join(SRC, relative), "utf-8");
}

/** `task_planner` -> `taskPlanner`, the prefix every procedure name uses. */
function camel(agentId: string): string {
  return agentId.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

describe("every pinnable agent is wired end to end", () => {
  const router = read("server/api/routers/agent.ts");
  const chat = read("components/projects/ProjectIntelligenceChat.tsx");
  const handoff = read("server/llm/orchestrator/handoff.ts");

  /*
   * Read as source rather than imported and inspected. Importing
   * `agentOrchestrator` pulls in A1's tool module, which reads server-only env
   * at module load and throws under the test environment. The layer this cannot
   * see — that the orchestrator really exports what the router calls — is
   * already enforced by `tsc`: the router calls these as typed members.
   */
  for (const agentId of HANDOFF_TARGETS) {
    const prefix = camel(agentId);

    it(`${agentId}: the agent router exposes draft, confirm and apply`, () => {
      for (const verb of ["Draft", "Confirm", "Apply"]) {
        expect(
          router,
          `agent router has no ${prefix}${verb} procedure — the plan cannot be applied from the client`,
        ).toContain(`${prefix}${verb}:`);
      }
    });

    it(`${agentId}: the handoff switch dispatches it`, () => {
      expect(handoff).toContain(`case "${agentId}"`);
    });
  }

  it("the chat renders every plan kind the handoff can produce", () => {
    // The kinds are declared in one place; a kind with no branch in the chat is
    // the exact shape of the A6 bug. Both comparison forms count — the events
    // branch is reached through a negative guard.
    const produced = [
      ...handoff.matchAll(/\{ kind: "([a-z_]+)"; draftId: string/g),
    ].map((m) => m[1]!);
    const rendered = new Set(
      [...chat.matchAll(/plan\.kind\s*[!=]==\s*"([a-z_]+)"/g)].map(
        (m) => m[1]!,
      ),
    );

    expect(produced.length).toBe(HANDOFF_TARGETS.length);
    expect(
      produced.filter((kind) => !rendered.has(kind)),
      "these plan kinds have no branch in the chat, so they fall through to 'no response'",
    ).toEqual([]);
  });
});
