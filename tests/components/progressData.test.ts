import { describe, it, expect } from "vitest";

import {
  RECORD_WEEKS,
  buildBoard,
  buildGrid,
  buildLog,
  buildSuggestions,
  buildTeamNotes,
  buildTeamRows,
  countByDay,
  daysBetween,
  formatTook,
  heatLevel,
  initialsOf,
  mergeCounts,
  normaliseEntries,
  projectTone,
  sortTeamRows,
  summarise,
  summariseTeam,
  teamHeatLevel,
  toYmd,
  windowLength,
  type RecordEntry,
  type TeamMemberPayload,
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

  it("measures everyone as a share of the leader", () => {
    const board = buildBoard(people);
    expect(board[0]!.share).toBe(1);
    expect(board[1]!.share).toBeCloseTo(96 / 132, 5);
  });

  it("keeps the reader on the board even outside the top five", () => {
    const board = buildBoard(people);
    expect(board).toHaveLength(5);
    expect(board.at(-1)!.id).toBe("me");
    // Shown in fifth place, but ranked where they actually stand.
    expect(board.at(-1)!.rank).toBe(6);
  });

  it("survives a board where nobody has finished anything", () => {
    const board = buildBoard([
      { id: "me", name: "Teodora B.", email: null, image: null, completed: 0, isSelf: true },
    ]);
    expect(board[0]!.share).toBe(0);
    expect(board[0]!.rank).toBe(1);
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

describe("the team view", () => {
  const member = (id: string, extra: Partial<TeamMemberPayload> = {}): TeamMemberPayload => ({
    id,
    name: `${id[0]!.toUpperCase()}${id.slice(1)} Test`,
    email: null,
    image: null,
    role: "member",
    displayRole: null,
    isSelf: false,
    open: 2,
    overdue: 0,
    lastFinishedAt: null,
    workload: [],
    ...extra,
  });
  const done = (userId: string, offset: number) => ({ userId, finishedAt: day(offset) });

  const members = [
    member("maya", { isSelf: true, open: 3, lastFinishedAt: day(0) }),
    member("petar", { open: 20, lastFinishedAt: day(1) }),
    member("nikol", { open: 4, lastFinishedAt: day(9) }),
    member("elena", { open: 0, lastFinishedAt: null }),
  ];
  const completions = [
    done("maya", 0),
    done("maya", 1),
    done("maya", 2),
    done("petar", 1),
    done("petar", 1),
    done("nikol", 9),
    // Outside every window but "all" — and a member no longer on the team.
    done("maya", 60),
    done("gone", 0),
  ];
  const rows = buildTeamRows({ today: TODAY, members, completions, window: "month" });
  const byId = (id: string) => rows.find((row) => row.member.id === id)!;

  it("counts each member's finishes inside the window", () => {
    expect(byId("maya").finished).toBe(3);
    expect(byId("petar").finished).toBe(2);
    expect(byId("nikol").finished).toBe(1);
    expect(byId("elena").finished).toBe(0);
  });

  it("ignores completions by people who are not on the team", () => {
    expect(rows).toHaveLength(4);
    expect(mergeCounts(rows.map((row) => row.counts)).get(toYmd(day(0)))).toBe(1);
  });

  it("draws a thirty-day strip ending today", () => {
    const strip = byId("petar").strip;
    expect(strip).toHaveLength(30);
    expect(strip.at(-1)).toBe(0);
    expect(strip.at(-2)).toBe(2);
  });

  it("flags quiet only when work is still open", () => {
    expect(byId("nikol").quiet).toBe(true);
    // Never finished anything, but nothing is open either: done, not quiet.
    expect(byId("elena").quiet).toBe(false);
    expect(byId("maya").quiet).toBe(false);
  });

  it("flags a load that is heavy for this team, not by a fixed number", () => {
    expect(byId("petar").heavy).toBe(true);
    expect(byId("nikol").heavy).toBe(false);
  });

  it("sorts by the column asked for, quietest first for quiet", () => {
    expect(sortTeamRows(rows, "finished").map((r) => r.member.id)[0]).toBe("maya");
    expect(sortTeamRows(rows, "open").map((r) => r.member.id)[0]).toBe("petar");
    // Never finished sorts as the quietest of all.
    expect(sortTeamRows(rows, "quiet").map((r) => r.member.id).slice(0, 2)).toEqual(["elena", "nikol"]);
  });

  it("summarises the team", () => {
    const summary = summariseTeam(rows, "month");
    expect(summary.finished).toBe(6);
    expect(summary.members).toBe(4);
    expect(summary.activeThisWeek).toBe(2);
    expect(summary.medianFinished).toBe(1.5);
    expect(summary.attention).toBe(2);
  });

  it("writes at most one note of each kind, and never about the reader", () => {
    const notes = buildTeamNotes({
      today: TODAY,
      rows,
      projects: [
        { projectId: 7, projectTitle: "Thesis", open: 5, people: 2, lastTouchedAt: day(12) },
        { projectId: 8, projectTitle: "Kairos", open: 5, people: 2, lastTouchedAt: day(20) },
      ],
    });
    expect(notes.map((n) => n.id)).toEqual(["quiet", "heavy", "stale"]);
    expect(notes[0]!.id === "quiet" && notes[0]!.memberId).toBe("nikol");
    expect(notes[1]!.id === "heavy" && notes[1]!.memberId).toBe("petar");
    expect(notes[2]!.id === "stale" && notes[2]!.projectTitle).toBe("Kairos");
  });

  it("grades a team day per head", () => {
    expect(teamHeatLevel(0, 6)).toBe(0);
    expect(teamHeatLevel(3, 6)).toBe(1);
    expect(teamHeatLevel(6, 6)).toBe(2);
    expect(teamHeatLevel(12, 6)).toBe(3);
    expect(teamHeatLevel(13, 6)).toBe(4);
  });
});
