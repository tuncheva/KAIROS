import { describe, it, expect } from "vitest";

import {
  RECORD_WEEKS,
  buildBoard,
  buildGrid,
  buildLog,
  buildSuggestions,
  countByDay,
  daysBetween,
  formatTook,
  heatLevel,
  initialsOf,
  normaliseEntries,
  projectTone,
  summarise,
  toYmd,
  windowLength,
  type RecordEntry,
} from "~/components/progress/progressModel";

/** Tuesday 25 August 2026 — the day the redesign is drawn against. */
const TODAY = new Date(2026, 7, 25);

const day = (offset: number, hour = 12) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - offset);
  d.setHours(hour, 0, 0, 0);
  return d;
};

let nextId = 1;
function finished(offset: number, opts?: { projectId?: number; createdDaysBefore?: number; hour?: number }): RecordEntry {
  const finishedAt = day(offset, opts?.hour ?? 12);
  const createdAt = new Date(finishedAt);
  createdAt.setDate(createdAt.getDate() - (opts?.createdDaysBefore ?? 1));
  return {
    id: nextId++,
    title: `Task ${nextId}`,
    projectId: opts?.projectId ?? 7,
    projectTitle: "Thesis",
    createdAt,
    finishedAt,
  };
}

describe("normaliseEntries", () => {
  it("buckets a completion into its local day, not UTC", () => {
    // 23:40 local on the 24th stays on the 24th; toISOString() would move a
    // positive-offset timezone to the 25th.
    const [task] = normaliseEntries([finished(1, { hour: 23 })]);
    expect(task!.ymd).toBe(toYmd(day(1)));
  });

  it("measures how long a task took from creation to completion", () => {
    const [task] = normaliseEntries([finished(0, { createdDaysBefore: 3 })]);
    expect(task!.tookDays).toBeCloseTo(3, 5);
  });

  it("drops entries with an unusable timestamp", () => {
    const broken = { ...finished(0), finishedAt: "not-a-date" };
    expect(normaliseEntries([broken])).toHaveLength(0);
  });

  it("returns newest first", () => {
    const tasks = normaliseEntries([finished(5), finished(0), finished(2)]);
    expect(tasks.map((t) => t.ymd)).toEqual([toYmd(day(0)), toYmd(day(2)), toYmd(day(5))]);
  });
});

describe("heatLevel", () => {
  it("ramps from empty to standout", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(heatLevel)).toEqual([0, 1, 2, 3, 3, 4, 4]);
  });
});

describe("buildGrid", () => {
  const counts = countByDay(normaliseEntries([finished(0), finished(0), finished(40)]));
  const weeks = buildGrid({ today: TODAY, counts, window: "month" });

  it("draws one column per week, Monday first", () => {
    expect(weeks).toHaveLength(RECORD_WEEKS);
    expect(weeks[0]!.days).toHaveLength(7);
    // 25 Aug 2026 is a Tuesday, so its column starts on Monday the 24th.
    expect(weeks.at(-1)!.days[0]!.date.getDay()).toBe(1);
  });

  it("marks today and leaves the rest of the week unrendered", () => {
    const lastWeek = weeks.at(-1)!;
    expect(lastWeek.days.filter((d) => d.isToday)).toHaveLength(1);
    expect(lastWeek.days.filter((d) => d.isFuture)).toHaveLength(5);
  });

  it("dims days outside the window instead of hiding them", () => {
    const outside = weeks.flatMap((w) => w.days).filter((d) => !d.inWindow && !d.isFuture);
    expect(outside.length).toBeGreaterThan(0);
    const fortyDaysAgo = weeks
      .flatMap((w) => w.days)
      .find((d) => d.ymd === toYmd(day(40)))!;
    expect(fortyDaysAgo.count).toBe(1);
    expect(fortyDaysAgo.inWindow).toBe(false);
  });

  it("labels a column only when a new month starts in it", () => {
    const labelled = weeks.filter((w) => w.monthLabel);
    expect(labelled.length).toBeGreaterThan(2);
    const months = labelled.map((w) => w.monthLabel!.getMonth());
    expect(new Set(months).size).toBe(months.length);
  });
});

describe("summarise", () => {
  it("counts only what falls inside the window", () => {
    const counts = countByDay(normaliseEntries([finished(1), finished(1), finished(20)]));
    expect(summarise({ today: TODAY, counts, window: "week" }).finished).toBe(2);
    expect(summarise({ today: TODAY, counts, window: "month" }).finished).toBe(3);
  });

  it("averages over the whole window, not over active days", () => {
    const counts = countByDay(normaliseEntries([finished(0), finished(1), finished(2)]));
    expect(summarise({ today: TODAY, counts, window: "week" }).perDay).toBe("0.4");
  });

  it("keeps a streak alive across a quiet today", () => {
    const counts = countByDay(normaliseEntries([finished(1), finished(2), finished(3)]));
    expect(summarise({ today: TODAY, counts, window: "month" }).streak).toBe(3);
  });

  it("breaks a streak on a quiet yesterday", () => {
    const counts = countByDay(normaliseEntries([finished(0), finished(2), finished(3)]));
    expect(summarise({ today: TODAY, counts, window: "month" }).streak).toBe(1);
  });

  it("reports the best day inside the window", () => {
    const counts = countByDay(
      normaliseEntries([finished(4), finished(4), finished(4), finished(1)]),
    );
    const summary = summarise({ today: TODAY, counts, window: "month" });
    expect(summary.bestCount).toBe(3);
    expect(toYmd(summary.bestDay!)).toBe(toYmd(day(4)));
  });

  it("compares this week against the one before", () => {
    const counts = countByDay(
      normaliseEntries([finished(1), finished(2), finished(8), finished(9), finished(10), finished(11)]),
    );
    const summary = summarise({ today: TODAY, counts, window: "week" });
    expect(summary.thisWeek).toBe(2);
    expect(summary.previousWeek).toBe(4);
    expect(summary.pacePercent).toBe(-50);
  });

  it("has no pace to report when the previous week was empty", () => {
    const counts = countByDay(normaliseEntries([finished(1)]));
    expect(summarise({ today: TODAY, counts, window: "week" }).pacePercent).toBeNull();
  });
});

describe("buildLog", () => {
  const tasks = normaliseEntries([
    finished(0),
    finished(2),
    finished(3),
    finished(9),
    finished(40),
  ]);

  it("shows the three most recent days that have something on them", () => {
    const groups = buildLog({ today: TODAY, tasks, window: "month", selectedYmd: null });
    expect(groups.map((g) => g.ymd)).toEqual([toYmd(day(0)), toYmd(day(2)), toYmd(day(3))]);
  });

  it("stays inside the window", () => {
    const groups = buildLog({ today: TODAY, tasks, window: "week", selectedYmd: null });
    expect(groups.map((g) => g.ymd)).toEqual([toYmd(day(0)), toYmd(day(2)), toYmd(day(3))]);
    const older = buildLog({
      today: TODAY,
      tasks: normaliseEntries([finished(40)]),
      window: "week",
      selectedYmd: null,
    });
    expect(older).toEqual([]);
  });

  it("narrows to a single selected day", () => {
    const groups = buildLog({
      today: TODAY,
      tasks,
      window: "all",
      selectedYmd: toYmd(day(9)),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(1);
  });

  it("returns nothing for a selected day with nothing on it", () => {
    const groups = buildLog({ today: TODAY, tasks, window: "all", selectedYmd: toYmd(day(1)) });
    expect(groups).toEqual([]);
  });
});

describe("buildSuggestions", () => {
  const summary = summarise({
    today: TODAY,
    counts: countByDay(normaliseEntries([finished(1), finished(8), finished(9), finished(10)])),
    window: "week",
  });

  it("reports a dropped pace, a stale project and the next task", () => {
    const suggestions = buildSuggestions({
      today: TODAY,
      summary,
      workload: [
        { projectId: 7, projectTitle: "Thesis", open: 7, lastTouchedAt: day(9) },
        { projectId: 8, projectTitle: "Kairos", open: 5, lastTouchedAt: day(0) },
      ],
      nextTask: {
        id: 31,
        title: "Submit ethics form",
        projectId: 9,
        projectTitle: "Research study",
        priority: "urgent",
        dueDate: day(-4),
        waitingBehind: 2,
      },
    });

    expect(suggestions.map((s) => s.id)).toEqual(["pace", "stale", "next"]);
    const pace = suggestions[0]!;
    expect(pace.id === "pace" && pace.direction).toBe("down");
    expect(pace.id === "pace" && pace.percent).toBe(67);
    const stale = suggestions[1]!;
    expect(stale.id === "stale" && stale.projectTitle).toBe("Thesis");
    expect(stale.id === "stale" && stale.quietDays).toBe(9);
  });

  it("stays quiet about a project that moved today", () => {
    const suggestions = buildSuggestions({
      today: TODAY,
      summary,
      workload: [{ projectId: 8, projectTitle: "Kairos", open: 5, lastTouchedAt: day(1) }],
      nextTask: null,
    });
    expect(suggestions.map((s) => s.id)).toEqual(["pace"]);
  });

  it("has nothing to say about an empty record", () => {
    const empty = summarise({ today: TODAY, counts: new Map(), window: "week" });
    expect(buildSuggestions({ today: TODAY, summary: empty, workload: [], nextTask: null })).toEqual(
      [],
    );
  });
});

describe("buildBoard", () => {
  const people = [
    { id: "a", name: "Ivan D.", email: null, image: null, completed: 132, isSelf: false },
    { id: "b", name: "Mira K.", email: null, image: null, completed: 96, isSelf: false },
    { id: "c", name: "Georgi P.", email: null, image: null, completed: 71, isSelf: false },
    { id: "d", name: "Nadia S.", email: null, image: null, completed: 54, isSelf: false },
    { id: "e", name: "Petar V.", email: null, image: null, completed: 40, isSelf: false },
    { id: "me", name: "Teodora B.", email: null, image: null, completed: 3, isSelf: true },
  ];

  it("scales the bars against the leader", () => {
    const board = buildBoard(people);
    expect(board[0]!.barHeight).toBe(150);
    expect(board[1]!.barHeight).toBe(Math.round((96 / 132) * 150));
  });

  it("keeps the reader on the board even outside the top five", () => {
    const board = buildBoard(people);
    expect(board).toHaveLength(5);
    expect(board.at(-1)!.id).toBe("me");
  });

  it("survives a board where nobody has finished anything", () => {
    const board = buildBoard([
      { id: "me", name: "Teodora B.", email: null, image: null, completed: 0, isSelf: true },
    ]);
    expect(board[0]!.barHeight).toBeGreaterThan(0);
  });
});

describe("small helpers", () => {
  it("measures whole days between local midnights", () => {
    expect(daysBetween(day(9, 23), TODAY)).toBe(9);
    expect(daysBetween(day(0, 1), TODAY)).toBe(0);
  });

  it("formats a duration in days, or hours below a day", () => {
    expect(formatTook(3.14)).toEqual({ value: "3.1", unit: "d" });
    expect(formatTook(0.25)).toEqual({ value: "6", unit: "h" });
    // Anything non-zero reads as at least an hour rather than as "0h".
    expect(formatTook(0.001)).toEqual({ value: "1", unit: "h" });
  });

  it("gives a project the same tone every time", () => {
    expect(projectTone(7)).toBe(projectTone(7));
    expect(projectTone(7)).not.toBe(projectTone(8));
  });

  it("builds initials from a name, or from an email when there is none", () => {
    expect(initialsOf({ name: "Teodora Boteva", email: null })).toBe("TB");
    expect(initialsOf({ name: null, email: "ivan.dimitrov@example.com" })).toBe("ID");
    expect(initialsOf({ name: null, email: null })).toBe("?");
  });

  it("maps each window to its length in days", () => {
    expect(WINDOWS.map(windowLength)).toEqual([7, 30, RECORD_WEEKS * 7]);
  });
});

const WINDOWS = ["week", "month", "all"] as const;
