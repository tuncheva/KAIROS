import { describe, it, expect } from "vitest";

import {
  loadLevelFor,
  summarizeWorkload,
  type WorkloadTaskRow,
} from "~/server/llm/context/assigneeWorkload";
import { getA2SystemPrompt } from "~/server/llm/prompts/a2Prompts";

const row = (r: Partial<WorkloadTaskRow> & Pick<WorkloadTaskRow, "assignedToId" | "projectId">): WorkloadTaskRow => ({
  open: 0,
  inProgress: 0,
  overdue: 0,
  dueThisWeek: 0,
  highPriorityOpen: 0,
  completedRecently: 0,
  ...r,
});

const candidates = [
  { id: "ana", name: "Ana" },
  { id: "bob", name: "Bob" },
  { id: "cem", name: "Cem" },
];

describe("loadLevelFor", () => {
  it("weighs overdue work double", () => {
    expect(loadLevelFor({ openTasks: 3, overdue: 0, highPriorityOpen: 0 })).toBe("light");
    expect(loadLevelFor({ openTasks: 3, overdue: 2, highPriorityOpen: 0 })).toBe("moderate");
    expect(loadLevelFor({ openTasks: 10, overdue: 3, highPriorityOpen: 0 })).toBe("heavy");
  });
});

describe("summarizeWorkload", () => {
  const result = summarizeWorkload({
    candidates,
    currentProjectId: 1,
    visibleTitleById: new Map([
      [1, "Website"],
      [2, "Mobile app"],
    ]),
    taskRows: [
      // Ana looks free here but is busy elsewhere, some of it out of view.
      row({ assignedToId: "ana", projectId: 1, open: 1 }),
      row({ assignedToId: "ana", projectId: 2, open: 6, overdue: 2 }),
      row({ assignedToId: "ana", projectId: 99, open: 5, highPriorityOpen: 2 }),
      row({ assignedToId: "bob", projectId: 1, open: 2, completedRecently: 3 }),
    ],
    activityRows: [
      { userId: "ana", actions: 12, lastActiveAt: new Date("2026-09-27T10:00:00Z") },
      { userId: "bob", actions: 4, lastActiveAt: new Date("2026-09-26T10:00:00Z") },
    ],
  });
  const byId = new Map(result.map((r) => [r.userId, r]));

  it("totals load across every project, not just the current one", () => {
    const ana = byId.get("ana")!;
    expect(ana.openInThisProject).toBe(1);
    expect(ana.openTasks).toBe(12);
    expect(ana.loadLevel).toBe("heavy");
  });

  it("names visible projects but only counts hidden ones", () => {
    const ana = byId.get("ana")!;
    expect(ana.otherVisibleProjects).toEqual([{ projectTitle: "Mobile app", openTasks: 6 }]);
    expect(ana.openInOtherProjectsNotVisible).toBe(5);
    expect(JSON.stringify(ana)).not.toContain("99");
  });

  it("flags someone with no recent activity", () => {
    expect(byId.get("cem")!.possiblyUnavailable).toBe(true);
    expect(byId.get("bob")!.possiblyUnavailable).toBe(false);
  });

  it("puts the lightest load first", () => {
    expect(result.map((r) => r.userId)).toEqual(["cem", "bob", "ana"]);
  });
});

describe("A2 prompt", () => {
  it("tells the planner to use cross-project workload when assigning", () => {
    const prompt = getA2SystemPrompt({
      memory: [],
      locale: "en",
      session: { userId: "ana" },
      scope: { projectId: 1 },
      collaborators: candidates,
      existingTasks: [],
    });
    expect(prompt).toContain("assigneeWorkload");
    expect(prompt).toContain("ALL of their projects");
  });
});
