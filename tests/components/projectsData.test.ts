import { describe, it, expect } from "vitest";

import {
  health,
  isRecent,
  matchesFilter,
  matchesTimelineFilter,
  projectRows,
  toTimelineEvent,
  upcomingEvents,
  visibleRows,
  workspaceTotals,
  type ActivityRow,
  type RawProject,
  type UpcomingTask,
} from "~/components/projects/projectsData";

/** Thursday 20 August 2026, 09:00 local. */
const NOW = new Date(2026, 7, 20, 9, 0, 0);
const at = (day: number, hour = 12) => new Date(2026, 7, day, hour, 0, 0);

const task = (status: string) => ({ status });

const projects: RawProject[] = [
  {
    // 3 of 5 done — 60%, on track.
    id: 1,
    title: "Дипломна работа",
    description: "Chapters, sources and defense prep",
    createdById: "me",
    updatedAt: at(20, 8),
    tasks: [
      task("completed"),
      task("completed"),
      task("completed"),
      task("in_progress"),
      task("pending"),
    ],
    collaborators: [{ id: "u1", name: "Мартин", image: null }],
  },
  {
    // 1 of 4 done — 25%, at risk.
    id: 2,
    title: "Apartment move",
    description: "Contracts, movers, utilities",
    createdById: "me",
    updatedAt: at(18),
    tasks: [task("completed"), task("pending"), task("pending"), task("pending")],
    collaborators: [],
  },
  {
    // Everything done.
    id: 3,
    title: "Team onboarding kit",
    description: "",
    createdById: "someone-else",
    updatedAt: at(6),
    tasks: [task("completed"), task("completed")],
  },
  {
    // No tasks at all.
    id: 4,
    title: "Reading list",
    description: null,
    createdById: "me",
    updatedAt: at(19),
    tasks: [],
  },
];

const rows = projectRows(projects, NOW);
const byId = (id: number) => rows.find((row) => row.id === id)!;

describe("health", () => {
  it("calls a project with no tasks empty rather than 0%", () => {
    expect(health(0, 0)).toBe("empty");
  });

  it("separates complete from on track at 100", () => {
    expect(health(100, 10)).toBe("complete");
    expect(health(99, 100)).toBe("onTrack");
  });

  it("steps down through the thresholds", () => {
    expect(health(60, 10)).toBe("onTrack");
    expect(health(59, 100)).toBe("inProgress");
    expect(health(30, 10)).toBe("inProgress");
    expect(health(29, 100)).toBe("atRisk");
  });
});

describe("projectRows", () => {
  it("counts each task bucket and derives completion", () => {
    const row = byId(1);
    expect(row).toMatchObject({ total: 5, done: 3, inProgress: 1, todo: 1, percent: 60 });
    expect(row.health).toBe("onTrack");
  });

  it("reports 0% and empty health for a project without tasks", () => {
    expect(byId(4)).toMatchObject({ total: 0, percent: 0, health: "empty" });
  });

  it("measures age in whole days from the last update", () => {
    expect(byId(1).ageDays).toBe(0);
    // 18 Aug 12:00 to 20 Aug 09:00 is 45 hours — one whole day elapsed, not two.
    expect(byId(2).ageDays).toBe(1);
  });

  it("normalises a missing description to an empty string", () => {
    expect(byId(4).description).toBe("");
  });

  it("falls back to createdAt when a project has never been updated", () => {
    const [row] = projectRows(
      [{ id: 9, title: "Fresh", description: null, createdById: "me", createdAt: at(18) }],
      NOW,
    );
    expect(row!.ageDays).toBe(1);
  });
});

describe("matchesFilter", () => {
  it("keeps everything under all", () => {
    expect(rows.every((row) => matchesFilter(row, "all"))).toBe(true);
  });

  it("puts only fully finished projects under done", () => {
    expect(rows.filter((row) => matchesFilter(row, "done")).map((row) => row.id)).toEqual([3]);
  });

  it("puts only on-track projects under track", () => {
    expect(rows.filter((row) => matchesFilter(row, "track")).map((row) => row.id)).toEqual([1]);
  });

  it("sweeps empty and behind projects into needs-attention", () => {
    // A project nobody has put a task in needs the same nudge as a stalled one.
    expect(rows.filter((row) => matchesFilter(row, "risk")).map((row) => row.id)).toEqual([2, 4]);
  });
});

describe("visibleRows", () => {
  const all = { query: "", filter: "all" as const, sort: "updated" as const };

  it("sorts by recency of update by default", () => {
    expect(visibleRows(rows, all).map((row) => row.id)).toEqual([1, 4, 2, 3]);
  });

  it("sorts by completion descending", () => {
    expect(visibleRows(rows, { ...all, sort: "progress" }).map((row) => row.id)).toEqual([
      3, 1, 2, 4,
    ]);
  });

  it("sorts by name", () => {
    // Cyrillic titles collate ahead of Latin ones, which is what `localeCompare`
    // does and what a Bulgarian workspace should see.
    expect(visibleRows(rows, { ...all, sort: "name" }).map((row) => row.id)).toEqual([1, 2, 4, 3]);
  });

  it("searches title and description case-insensitively", () => {
    expect(visibleRows(rows, { ...all, query: "MOVERS" }).map((row) => row.id)).toEqual([2]);
    expect(visibleRows(rows, { ...all, query: "reading" }).map((row) => row.id)).toEqual([4]);
  });

  it("treats a whitespace-only query as no query", () => {
    expect(visibleRows(rows, { ...all, query: "   " })).toHaveLength(rows.length);
  });

  it("applies the filter and the query together", () => {
    expect(visibleRows(rows, { ...all, filter: "risk", query: "apartment" }).map((r) => r.id)).toEqual([
      2,
    ]);
  });

  it("does not mutate the input order", () => {
    const before = rows.map((row) => row.id);
    visibleRows(rows, { ...all, sort: "name" });
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe("workspaceTotals", () => {
  it("counts unfinished projects with tasks as active", () => {
    // Not project 3 (complete) and not project 4 (no tasks).
    expect(workspaceTotals(rows).active).toBe(2);
  });

  it("totals tasks across every project", () => {
    expect(workspaceTotals(rows)).toMatchObject({ tasks: 11, completed: 6, percent: 55 });
  });

  it("reports 0% rather than dividing by zero", () => {
    expect(workspaceTotals([byId(4)])).toMatchObject({ tasks: 0, percent: 0 });
  });
});

/* ------------------------------------------------------------------ timeline */

const activity = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 1,
  action: "created",
  oldValue: null,
  newValue: null,
  createdAt: at(20, 8),
  taskTitle: "Chapter 2 review",
  user: { id: "u1", name: "Мартин", email: null },
  ...over,
});

describe("toTimelineEvent", () => {
  it("reads a move to completed as a completion, not a status change", () => {
    const event = toTimelineEvent(
      activity({ action: "status_changed", oldValue: "in_progress", newValue: "completed" }),
      "Someone",
    );
    expect(event).toMatchObject({ kind: "task", verb: "completed" });
  });

  it("keeps other status moves as status changes and shows the transition", () => {
    const event = toTimelineEvent(
      activity({ action: "status_changed", oldValue: "pending", newValue: "in_progress" }),
      "Someone",
    );
    expect(event).toMatchObject({ kind: "status", verb: "moved", detail: "pending → in_progress" });
  });

  it("maps a completion note to the notes stream", () => {
    const event = toTimelineEvent(
      activity({ action: "completion_note_set", newValue: "Reads well." }),
      "Someone",
    );
    expect(event).toMatchObject({ kind: "note", verb: "noted", detail: "Reads well." });
  });

  it("names the actor by email when they have no display name", () => {
    const event = toTimelineEvent(
      activity({ user: { id: "u2", name: null, email: "elena@shopmetrics.com" } }),
      "Someone",
    );
    expect(event?.actor).toBe("elena@shopmetrics.com");
  });

  it("falls back to the anonymous label when the user is gone", () => {
    expect(toTimelineEvent(activity({ user: null }), "Someone")?.actor).toBe("Someone");
  });

  it("drops a row with no usable timestamp rather than rendering an invalid date", () => {
    expect(toTimelineEvent(activity({ createdAt: null }), "Someone")).toBeNull();
    expect(toTimelineEvent(activity({ createdAt: "not a date" }), "Someone")).toBeNull();
  });
});

describe("upcomingEvents", () => {
  const tasks: UpcomingTask[] = [
    { id: 1, title: "Defense slot", status: "pending", dueDate: at(28) },
    { id: 2, title: "Chapter 2 review", status: "pending", dueDate: at(26) },
    { id: 3, title: "Already handled", status: "completed", dueDate: at(27) },
    { id: 4, title: "Overdue thing", status: "pending", dueDate: at(19) },
    { id: 5, title: "No deadline", status: "pending", dueDate: null },
  ];

  it("keeps only unfinished tasks with a deadline still ahead", () => {
    expect(upcomingEvents(tasks, NOW).map((event) => event.key)).toEqual(["due-1", "due-2"]);
  });

  it("orders furthest deadline first so the list reads down into the present", () => {
    const [first, second] = upcomingEvents(tasks, NOW);
    expect(first!.at.getTime()).toBeGreaterThan(second!.at.getTime());
  });

  it("marks the entries as future and as due", () => {
    expect(upcomingEvents(tasks, NOW)[0]).toMatchObject({ future: true, kind: "due", verb: "isDue" });
  });

  it("honours the limit", () => {
    expect(upcomingEvents(tasks, NOW, 1)).toHaveLength(1);
  });
});

describe("matchesTimelineFilter", () => {
  const event = toTimelineEvent(activity(), "Someone")!;

  it("lets everything through under all", () => {
    expect(matchesTimelineFilter(event, "all")).toBe(true);
  });

  it("filters by kind", () => {
    expect(matchesTimelineFilter(event, "task")).toBe(true);
    expect(matchesTimelineFilter(event, "note")).toBe(false);
  });
});

describe("isRecent", () => {
  const event = (date: Date) => ({ ...toTimelineEvent(activity(), "x")!, at: date });

  it("counts today and yesterday as the recent head", () => {
    expect(isRecent(event(at(20, 1)), NOW)).toBe(true);
    expect(isRecent(event(at(19, 23)), NOW)).toBe(true);
  });

  it("pushes anything older into the collapsed tail", () => {
    expect(isRecent(event(at(18, 23)), NOW)).toBe(false);
  });
});
