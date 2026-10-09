/**
 * What a user may let save without asking (Phase 5): at most three changes,
 * nothing deleted, nothing assigned to someone else, and no locked notes.
 */

import { describe, expect, it } from "vitest";

import { isSmallNotesPlan, isSmallTaskPlan } from "~/server/llm/agents/smallPlans";
import { NotesVaultDraftSchema } from "~/server/llm/schemas/a3NotesVaultSchemas";
import { TaskPlanDraftSchema } from "~/server/llm/schemas/a2TaskPlannerSchemas";

const ME = "me";

const create = (n: number, assignedToId?: string) => ({
  title: `Task ${n}`,
  priority: "medium" as const,
  clientRequestId: `client-request-${n}`,
  ...(assignedToId ? { assignedToId } : {}),
});

const tasks = (extra: Record<string, unknown>) =>
  TaskPlanDraftSchema.parse({ agentId: "task_planner", scope: { projectId: 1 }, ...extra });

describe("isSmallTaskPlan", () => {
  it("accepts up to three changes of any kind", () => {
    expect(isSmallTaskPlan(tasks({ creates: [create(1)] }), ME)).toBe(true);
    expect(
      isSmallTaskPlan(
        tasks({
          creates: [create(1)],
          statusChanges: [{ taskId: 7, status: "completed" }],
          comments: [{ taskId: 7, content: "Done." }],
        }),
        ME,
      ),
    ).toBe(true);
  });

  it("refuses four or more, and an empty plan", () => {
    expect(isSmallTaskPlan(tasks({ creates: [1, 2, 3, 4].map((n) => create(n)) }), ME)).toBe(false);
    expect(isSmallTaskPlan(tasks({}), ME)).toBe(false);
  });

  it("refuses any delete, however small the plan", () => {
    expect(
      isSmallTaskPlan(tasks({ deletes: [{ taskId: 3, reason: "Duplicate", dangerous: true }] }), ME),
    ).toBe(false);
  });

  it("refuses work assigned to someone else, including taking a task off them", () => {
    expect(isSmallTaskPlan(tasks({ creates: [create(1, ME)] }), ME)).toBe(true);
    expect(isSmallTaskPlan(tasks({ creates: [create(1, "ana")] }), ME)).toBe(false);
    expect(
      isSmallTaskPlan(tasks({ updates: [{ taskId: 5, patch: { assignedToId: null } }] }), ME),
    ).toBe(false);
  });

  it("refuses a plan that still has a question for the user", () => {
    expect(
      isSmallTaskPlan(tasks({ creates: [create(1)], questionsForUser: ["Which sprint?"] }), ME),
    ).toBe(false);
  });
});

const notes = (operations: unknown[], blocked: unknown[] = []) =>
  NotesVaultDraftSchema.parse({ agentId: "notes_vault", summary: "Notes.", operations, blocked });

describe("isSmallNotesPlan", () => {
  it("accepts a few creates and edits", () => {
    expect(isSmallNotesPlan(notes([{ type: "create", content: "Hello" }]))).toBe(true);
  });

  it("refuses deletes, locked notes, blocked notes and more than three changes", () => {
    expect(
      isSmallNotesPlan(notes([{ type: "delete", noteId: 1, reason: "Old", dangerous: true }])),
    ).toBe(false);
    expect(
      isSmallNotesPlan(
        notes([{ type: "update", noteId: 1, nextContent: "x", requiresUnlocked: true }]),
      ),
    ).toBe(false);
    expect(
      isSmallNotesPlan(notes([{ type: "create", content: "x" }], [{ noteId: 2, reason: "Locked" }])),
    ).toBe(false);
    expect(
      isSmallNotesPlan(notes([1, 2, 3, 4].map((n) => ({ type: "create", content: `Note ${n}` })))),
    ).toBe(false);
  });
});
