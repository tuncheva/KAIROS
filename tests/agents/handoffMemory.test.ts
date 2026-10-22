import { describe, expect, it, vi } from "vitest";

/**
 * `handoff.ts` pulls in every sub-agent and, through them, `~/server/db`, which
 * cannot load here. Only the pure helpers are under test.
 */
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/env", () => ({ env: { AUTH_SECRET: "x".repeat(32) } }));

const { handoffContextMessages } = await import("~/server/llm/prompts/handoffContext");
const { handoffReplies } = await import("~/server/llm/orchestrator/handoff");
type AgentPlan = Parameters<typeof handoffReplies>[0][number];

describe("handoffContextMessages", () => {
  it("shows the sub-agent what A1 already collected", () => {
    const [message] = handoffContextMessages({ projectName: "училище" });

    expect(message?.role).toBe("system");
    expect(message?.content).toContain('"projectName": "училище"');
    expect(message?.content).toMatch(/do not ask for them again/);
  });

  it("adds nothing when there is nothing to add", () => {
    expect(handoffContextMessages(undefined)).toEqual([]);
    expect(handoffContextMessages({})).toEqual([]);
    expect(handoffContextMessages({ projectName: " ", tags: [], extra: null })).toEqual([]);
  });

  it("never puts unlocked note plaintext in a prompt", () => {
    const messages = handoffContextMessages({
      unlockedNotes: [{ id: 3, plaintext: "secret" }],
      noteTitle: "Plan",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).not.toContain("secret");
    expect(messages[0]?.content).toContain("noteTitle");
  });
});

describe("handoffReplies", () => {
  it("keeps what each sub-agent told the user, questions included", () => {
    const plans = [
      {
        kind: "project_manager",
        draftId: "d1",
        plan: { summary: "Нужни са още детайли.", questions: ["Как да се казва проектът?"] },
      },
    ] as unknown as AgentPlan[];

    expect(handoffReplies(plans)).toEqual([
      {
        agent: "project_manager",
        summary: "Нужни са още детайли.",
        questions: ["Как да се казва проектът?"],
      },
    ]);
  });

  it("maps each plan kind to the agent that produced it", () => {
    const plans = [
      { kind: "tasks", draftId: "a", plan: { summary: "3 tasks" } },
      { kind: "org", draftId: "b", plan: { summary: "Invite", questions: [] } },
    ] as unknown as AgentPlan[];

    expect(handoffReplies(plans).map((r) => r.agent)).toEqual(["task_planner", "org_admin"]);
  });

  it("skips a plan with nothing to say", () => {
    const plans = [{ kind: "events", draftId: "c", plan: { creates: [] } }] as unknown as AgentPlan[];

    expect(handoffReplies(plans)).toEqual([]);
  });
});
