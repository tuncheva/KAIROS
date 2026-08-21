/**
 * Pinning an agent, and the guarantee that Auto is unchanged.
 *
 * The picker's whole promise is that choosing a specialist reaches that
 * specialist. The regression that matters more, though, is the other one: Auto
 * is the default, every existing caller sends no agent at all, and A1's routing
 * — including multi-agent handoff — has to behave exactly as it did before the
 * pin existed.
 *
 * The orchestrator modules are mocked because this is a test about *dispatch*,
 * not about what any agent produces: it should fail when the wiring is wrong,
 * not when a prompt is reworded.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const a1Draft = vi.fn();
const taskPlannerDraft = vi.fn();
const notesVaultDraft = vi.fn();
const eventsPublisherDraft = vi.fn();
const orgAdminDraft = vi.fn();

vi.mock("~/server/llm/orchestrator/a1Concierge", () => ({
  a1Concierge: { draft: a1Draft },
}));
vi.mock("~/server/llm/orchestrator/a2TaskPlanner", () => ({
  a2TaskPlanner: { taskPlannerDraft },
}));
vi.mock("~/server/llm/orchestrator/a3NotesVault", () => ({
  a3NotesVault: { notesVaultDraft },
}));
vi.mock("~/server/llm/orchestrator/a4EventsPublisher", () => ({
  a4EventsPublisher: { eventsPublisherDraft },
}));
vi.mock("~/server/llm/orchestrator/a5OrgAdmin", () => ({
  a5OrgAdmin: { orgAdminDraft },
}));

const { runAgentTurn } = await import("~/server/llm/orchestrator/handoff");

/** The minimum `runAgentTurn` needs; the mocks ignore all of it. */
const BASE = {
  ctx: {} as never,
  message: "do the thing",
};

/** An A1 response that answers without handing off. */
function a1Answers() {
  return {
    draftId: "a1-draft",
    outputJson: {
      intent: { type: "answer", scope: {} },
      answer: { summary: "Here you go." },
      handoffs: [],
    },
  };
}

/** An A1 response that hands off to the given agents. */
function a1HandsOffTo(...targets: string[]) {
  return {
    draftId: "a1-draft",
    outputJson: {
      intent: { type: "handoff", scope: {} },
      handoffs: targets.map((targetAgent) => ({
        targetAgent,
        context: {},
        userIntent: "sub intent",
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  taskPlannerDraft.mockResolvedValue({ draftId: "a2-draft", plan: { ok: true } });
  notesVaultDraft.mockResolvedValue({ draftId: "a3-draft", plan: { ok: true } });
  eventsPublisherDraft.mockResolvedValue({ draftId: "a4-draft", plan: { ok: true } });
  orgAdminDraft.mockResolvedValue({ draftId: "a5-draft", plan: { ok: true } });
});

describe("Auto — unchanged by the picker", () => {
  it("runs A1 when no agent is pinned", async () => {
    a1Draft.mockResolvedValue(a1Answers());

    const result = await runAgentTurn(BASE);

    expect(a1Draft).toHaveBeenCalledTimes(1);
    expect(result.plans).toEqual([]);
    expect(result.a1.answer?.summary).toBe("Here you go.");
  });

  it("still routes a handoff A1 asked for", async () => {
    a1Draft.mockResolvedValue(a1HandsOffTo("notes_vault"));

    const result = await runAgentTurn(BASE);

    expect(notesVaultDraft).toHaveBeenCalledTimes(1);
    expect(result.plan?.kind).toBe("notes");
  });

  it("still runs several sub-agents in one turn", async () => {
    // E-2. "Break down Alpha, note the risks, and schedule the kickoff" is one
    // sentence and three domains; this is the behaviour the pin must not break.
    a1Draft.mockResolvedValue(
      a1HandsOffTo("task_planner", "notes_vault", "events_publisher"),
    );

    const result = await runAgentTurn(BASE);

    expect(result.plans.map((p) => p.kind)).toEqual(["tasks", "notes", "events"]);
  });

  it("keeps A1's answer when a sub-agent fails", async () => {
    a1Draft.mockResolvedValue(a1HandsOffTo("task_planner"));
    taskPlannerDraft.mockRejectedValue(new Error("planner exploded"));

    const result = await runAgentTurn(BASE);

    expect(result.plans).toEqual([]);
    expect(result.handoffErrors).toEqual(["planner exploded"]);
  });
});

describe("pinned agent", () => {
  it("skips A1 entirely", async () => {
    // Asking A1 to route to a foregone conclusion is a model call whose answer
    // is already known — and one it could disagree with.
    const result = await runAgentTurn({ ...BASE, pinnedAgent: "task_planner" });

    expect(a1Draft).not.toHaveBeenCalled();
    expect(taskPlannerDraft).toHaveBeenCalledTimes(1);
    expect(result.plan?.kind).toBe("tasks");
  });

  it("passes the user's own message through as the intent", async () => {
    await runAgentTurn({ ...BASE, pinnedAgent: "notes_vault" });

    expect(notesVaultDraft).toHaveBeenCalledWith(
      expect.objectContaining({ message: "do the thing" }),
    );
  });

  it("reports the sub-agent's draft id as the turn's", async () => {
    // There is no A1 draft to fall back on, and the Apply button needs an id
    // that actually resolves to a plan.
    const result = await runAgentTurn({ ...BASE, pinnedAgent: "events_publisher" });

    expect(result.draftId).toBe("a4-draft");
  });

  it("reaches each pinnable agent", async () => {
    const cases = [
      ["task_planner", taskPlannerDraft, "tasks"],
      ["notes_vault", notesVaultDraft, "notes"],
      ["events_publisher", eventsPublisherDraft, "events"],
      ["org_admin", orgAdminDraft, "org"],
    ] as const;

    for (const [agent, spy, kind] of cases) {
      vi.clearAllMocks();
      const result = await runAgentTurn({ ...BASE, pinnedAgent: agent });
      expect(spy, `${agent} was not reached`).toHaveBeenCalledTimes(1);
      expect(result.plan?.kind).toBe(kind);
    }
  });

  it("surfaces a failure instead of swallowing it", async () => {
    // Unlike the Auto path, there is no A1 answer worth delivering alongside an
    // apology: the requested agent *is* the turn.
    orgAdminDraft.mockRejectedValue(new Error("not an admin"));

    await expect(
      runAgentTurn({ ...BASE, pinnedAgent: "org_admin" }),
    ).rejects.toThrow("not an admin");
  });

  it("produces an A1 output that carries the handoff but invents no answer", async () => {
    const result = await runAgentTurn({ ...BASE, pinnedAgent: "task_planner" });

    expect(result.a1.intent.type).toBe("handoff");
    expect(result.a1.handoff?.targetAgent).toBe("task_planner");
    // A1 never ran, so putting words in its mouth would be a fabrication — and
    // the chat already renders the plan when there is no summary.
    expect(result.a1.answer).toBeUndefined();
  });
});
