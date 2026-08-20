import { describe, it, expect } from "vitest";

import {
  headlineStats,
  projectSummaries,
  taskState,
  todayTasks,
  weekStrip,
  type CalendarTask,
  type DashboardProject,
} from "~/components/dashboard/dashboardData";

/** Thursday 20 August 2026, 09:00 local — the day the design is drawn against. */
const NOW = new Date(2026, 7, 20, 9, 0, 0);
const day = (d: number, hour = 12) => new Date(2026, 7, d, hour, 0, 0);

const projects: DashboardProject[] = [
  {
    id: 1,
    title: "Project one",
    tasks: [
      { id: 1, status: "in_progress", dueDate: day(20) },
      { id: 2, status: "pending", dueDate: day(21) },
      { id: 3, status: "completed", dueDate: day(18) },
      { id: 4, status: "completed", dueDate: null },
    ],
  },
  {
    id: 2,
    title: "Project two",
    tasks: [
      { id: 5, status: "pending", dueDate: day(19) }, // overdue
      { id: 6, status: "pending", dueDate: day(20) },
      { id: 7, status: "pending", dueDate: day(30) }, // beyond the week
      { id: 8, status: "blocked", dueDate: null },
    ],
  },
  { id: 3, title: "Project three", tasks: [] },
];

describe("headlineStats", () => {
  const stats = headlineStats(projects, NOW);

  it("counts tasks due today, ignoring completed ones", () => {
    expect(stats.dueToday).toBe(2);
  });

  it("counts anything past due that is still open", () => {
    expect(stats.overdue).toBe(1);
  });

  it("counts open work inside the next seven days only", () => {
    // due today (2) + tomorrow (1); the 30th falls outside the window.
    expect(stats.openThisWeek).toBe(3);
  });

  it("reports completion across every project", () => {
    expect(stats.completed).toBe(2);
    expect(stats.totalTasks).toBe(8);
    expect(stats.percent).toBe(25);
  });

  it("splits the remaining work into active and to-do", () => {
    expect(stats.inProgress).toBe(1);
    expect(stats.todo).toBe(5);
    expect(stats.projectCount).toBe(3);
  });

  it("does not divide by zero on an empty workspace", () => {
    expect(headlineStats([], NOW).percent).toBe(0);
  });
});

describe("taskState", () => {
  it("labels completed work done even when the due date has passed", () => {
    expect(taskState({ status: "completed", dueDate: day(1) }, NOW)).toBe("done");
  });

  it("labels open work with a past due date overdue", () => {
    expect(taskState({ status: "in_progress", dueDate: day(19) }, NOW)).toBe("overdue");
  });

  it("treats a due date earlier today as still due, not overdue", () => {
    expect(taskState({ status: "pending", dueDate: day(20, 1) }, NOW)).toBe("todo");
  });

  it("distinguishes active work from untouched work", () => {
    expect(taskState({ status: "in_progress", dueDate: null }, NOW)).toBe("inProgress");
    expect(taskState({ status: "pending", dueDate: null }, NOW)).toBe("todo");
  });
});

const calendarTasks: CalendarTask[] = [
  { id: 1, title: "Overdue one", status: "pending", dueDate: day(19), projectId: 2, projectTitle: "Project two" },
  { id: 2, title: "Today open", status: "in_progress", dueDate: day(20), projectId: 1, projectTitle: "Project one" },
  { id: 3, title: "Today done", status: "completed", dueDate: day(20), projectId: 1, projectTitle: "Project one" },
  { id: 4, title: "Tomorrow", status: "pending", dueDate: day(21), projectId: 1, projectTitle: "Project one" },
  { id: 5, title: "Old and done", status: "completed", dueDate: day(10), projectId: 1, projectTitle: "Project one" },
];

describe("todayTasks", () => {
  const rows = todayTasks(calendarTasks, NOW);

  it("lists overdue work first, then today's, with completed last", () => {
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("leaves out later days and already-closed past work", () => {
    expect(rows.map((r) => r.title)).not.toContain("Tomorrow");
    expect(rows.map((r) => r.title)).not.toContain("Old and done");
  });
});

describe("weekStrip", () => {
  const strip = weekStrip(calendarTasks, NOW);

  it("starts today and skips the weekend", () => {
    expect(strip.map((d) => d.date.getDate())).toEqual([20, 21, 24, 25, 26]);
    expect(strip[0]?.isToday).toBe(true);
  });

  it("counts only open tasks per day", () => {
    expect(strip[0]?.count).toBe(1); // "Today done" excluded
    expect(strip[1]?.count).toBe(1);
    expect(strip[2]?.count).toBe(0);
  });
});

describe("projectSummaries", () => {
  const summaries = projectSummaries(projects, NOW);

  it("puts at-risk projects first and empty ones last", () => {
    expect(summaries.map((s) => s.health)).toEqual(["atRisk", "inProgress", "empty"]);
    expect(summaries[0]?.id).toBe(2);
    expect(summaries.at(-1)?.id).toBe(3);
  });

  it("reports completion and open counts per project", () => {
    const one = summaries.find((s) => s.id === 1);
    expect(one?.percent).toBe(50);
    expect(one?.openCount).toBe(2);
  });

  it("leaves a project with no tasks without a percentage", () => {
    const empty = summaries.find((s) => s.id === 3);
    expect(empty?.percent).toBeNull();
    expect(empty?.openCount).toBe(0);
  });

  it("flags a project on track once most of its work is closed", () => {
    const [summary] = projectSummaries(
      [
        {
          id: 9,
          title: "Nearly done",
          tasks: [
            { id: 1, status: "completed", dueDate: day(18) },
            { id: 2, status: "completed", dueDate: day(18) },
            { id: 3, status: "completed", dueDate: day(18) },
            { id: 4, status: "pending", dueDate: day(25) },
          ],
        },
      ],
      NOW,
    );
    expect(summary?.health).toBe("onTrack");
    expect(summary?.percent).toBe(75);
  });
});
