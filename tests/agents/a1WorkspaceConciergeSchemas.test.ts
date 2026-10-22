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

/* ─────────── empty placeholder payloads ─────────── */

describe("A1OutputSchema empty payloads", () => {
  // Seen live from gpt-oss-20b: a correct handoff with every other key
  // filled in as an empty placeholder.
  it("accepts a handoff that arrives with empty answer and clarify", () => {
    const out = A1OutputSchema.parse({
      intent: { type: "handoff", scope: {} },
      handoffs: [
        {
          targetAgent: "project_manager",
          context: { projectName: "училище" },
          userIntent: "Създай проект с име „училище“",
        },
      ],
      answer: {},
      clarify: {},
      citations: [],
      followUps: [],
    });

    expect(out.handoff?.targetAgent).toBe("project_manager");
    expect(out.answer).toBeUndefined();
    expect(out.clarify).toBeUndefined();
  });

  it("does not infer a type from an empty payload", () => {
    expect(() => A1OutputSchema.parse({ intent: {}, answer: {} })).toThrow();
  });

  it("keeps an answer that has content beside a handoff", () => {
    const out = A1OutputSchema.parse({
      intent: { type: "handoff", scope: {} },
      handoffs: [{ targetAgent: "task_planner", context: {}, userIntent: "Plan it" }],
      answer: { summary: "Passing this to the planner." },
    });

    expect(out.answer?.summary).toBe("Passing this to the planner.");
  });
});
