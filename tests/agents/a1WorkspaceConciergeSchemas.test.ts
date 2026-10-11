import { describe, it, expect } from "vitest";
import { A1OutputSchema } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";

/* ─────────── intent.type inference ─────────── */

describe("A1OutputSchema intent.type", () => {
  it("keeps an explicit type", () => {
    const out = A1OutputSchema.parse({
      intent: { type: "answer", scope: {} },
      answer: { summary: "Two tasks are overdue." },
    });
    expect(out.intent.type).toBe("answer");
  });

  it("infers answer when the model drops the type", () => {
    const out = A1OutputSchema.parse({
      intent: { scope: { projectId: 4 } },
      answer: { summary: "Two tasks are overdue." },
    });
    expect(out.intent.type).toBe("answer");
    expect(out.intent.scope.projectId).toBe(4);
  });

  it("infers handoff from handoffs or handoff", () => {
    const handoff = {
      targetAgent: "task_planner",
      context: {},
      userIntent: "Break down Alpha",
    };
    expect(
      A1OutputSchema.parse({ intent: {}, handoffs: [handoff] }).intent.type,
    ).toBe("handoff");
    expect(A1OutputSchema.parse({ intent: {}, handoff }).intent.type).toBe(
      "handoff",
    );
  });

  it("infers clarify and draft_plan", () => {
    expect(
      A1OutputSchema.parse({
        intent: {},
        clarify: { question: "Which project?" },
      }).intent.type,
    ).toBe("clarify");
    expect(
      A1OutputSchema.parse({
        intent: {},
        draftPlan: { readQueries: [], proposedChanges: [], applyCalls: [] },
      }).intent.type,
    ).toBe("draft_plan");
  });

  it("infers the type when intent itself is missing", () => {
    const out = A1OutputSchema.parse({
      answer: { summary: "Two tasks are overdue." },
    });
    expect(out.intent).toEqual({ type: "answer", scope: {} });
  });

  it("still rejects a reply with no type and no payload", () => {
    expect(() => A1OutputSchema.parse({ intent: {} })).toThrow();
  });
});
