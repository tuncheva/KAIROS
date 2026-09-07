import { describe, expect, it } from "vitest";
import {
  MAX_RANGE_DAYS,
  ROW_HEIGHT,
  groupByDay,
  hourWindow,
  isoWeek,
  layoutTimedItems,
  matchesFilters,
  rangeBounds,
  startOfWeekMonday,
  toCalendarItems,
  toYmd,
  visibleDays,
  type CalendarItem,
  type CalendarKind,
  type ItemFilters,
} from "~/components/calendar/calendarModel";

/* These exercise the real helpers the calendar renders from, rather than a
   copy of the logic — the previous version of this file reimplemented the
   filter inline, so it could pass while production drifted away from it. */

function task(overrides: Partial<Extract<CalendarItem, { kind: "task" }>> = {}) {
  return {
    kind: "task",
    id: 1,
    title: "Write docs",
    date: new Date(2026, 3, 8, 9, 0),
    allDay: false,
    status: "pending",
    priority: "high",
    projectId: 7,
    projectTitle: "Kairos",
    ...overrides,
  } satisfies Extract<CalendarItem, { kind: "task" }>;
}

function event(overrides: Partial<Extract<CalendarItem, { kind: "event" }>> = {}) {
  return {
    kind: "event",
    id: 2,
    title: "Launch",
    date: new Date(2026, 3, 8, 10, 0),
    allDay: false,
    endsAt: null,
    description: "",
    ...overrides,
  } satisfies Extract<CalendarItem, { kind: "event" }>;
}

function allFilters(overrides: Partial<ItemFilters> = {}): ItemFilters {
  return {
    query: "",
    kinds: new Set<CalendarKind>(["task", "event", "note"]),
    statuses: new Set(["pending", "in_progress", "blocked", "completed"]),
    priorities: new Set(["urgent", "high", "medium", "low"]),
    ...overrides,
  };
}

describe("calendar periods", () => {
  it("starts weeks on Monday", () => {
    // Wed, 2026-04-08
    const week = startOfWeekMonday(new Date(2026, 3, 8, 12, 0));
    expect(week.getDay()).toBe(1);
    expect(toYmd(week)).toBe("2026-04-06");
    expect(week.getHours()).toBe(0);
  });

  it("shows 1, 7 and 42 days for day, week and month views", () => {
    const anchor = new Date(2026, 3, 8, 12, 0);
    expect(visibleDays("day", anchor)).toHaveLength(1);
    expect(visibleDays("week", anchor)).toHaveLength(7);
    expect(visibleDays("month", anchor)).toHaveLength(42);
  });

  it("pads the month grid to whole Monday-start weeks around the month", () => {
    // April 2026 starts on a Wednesday, so the grid opens on Mon 30 March.
    const grid = visibleDays("month", new Date(2026, 3, 15));
    expect(toYmd(grid[0]!)).toBe("2026-03-30");
    expect(grid[0]!.getDay()).toBe(1);
    expect(grid[41]!.getDay()).toBe(0);
    expect(grid.some((d) => toYmd(d) === "2026-04-01")).toBe(true);
    expect(grid.some((d) => toYmd(d) === "2026-04-30")).toBe(true);
  });

  it("numbers ISO weeks", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2026, 7, 25))).toBe(35);
  });
});

describe("calendar filtering", () => {
  it("filters by kind, and by status and priority for tasks only", () => {
    const items: CalendarItem[] = [
      task({ id: 1, status: "pending", priority: "high" }),
      task({ id: 2, status: "completed", priority: "low", projectTitle: null }),
      event({ id: 3 }),
      {
        kind: "note",
        id: 4,
        title: "Idea",
        date: new Date(2026, 3, 8, 0, 0),
        allDay: true,
        locked: false,
      },
    ];

    const filters = allFilters({
      kinds: new Set<CalendarKind>(["task", "note"]),
      statuses: new Set(["pending"]),
      priorities: new Set(["high"]),
    });

    expect(items.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual([1, 4]);
  });

  it("searches titles plus the project on tasks and the description on events", () => {
    const items: CalendarItem[] = [
      task({ id: 1, title: "Write docs", projectTitle: "Kairos" }),
      event({ id: 2, title: "Demo", description: "Kairos showcase" }),
      {
        kind: "note",
        id: 3,
        title: "Random",
        date: new Date(2026, 3, 8, 0, 0),
        allDay: true,
        locked: false,
      },
    ];

    const filters = allFilters({ query: "  KaIrOs " });
    expect(items.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual([1, 2]);
  });
});

describe("mapping router rows to calendar items", () => {
  it("treats midnight entries as all-day and drops undated rows", () => {
    const items = toCalendarItems(
      {
        tasks: [
          {
            id: 1,
            title: "Timed task",
            status: "pending",
            priority: "medium",
            dueDate: new Date(2026, 3, 8, 14, 30),
            projectId: 7,
            projectTitle: "Kairos",
          },
          {
            id: 2,
            title: "Undated",
            status: "pending",
            priority: "medium",
            dueDate: null,
            projectId: 7,
            projectTitle: "Kairos",
          },
        ],
        events: [
          {
            id: 3,
            title: "All-day event",
            eventDate: new Date(2026, 3, 8, 0, 0),
            endsAt: null,
            description: "d",
          },
        ],
        notes: [
          {
            id: 4,
            title: null,
            calendarDate: new Date(2026, 3, 8, 0, 0),
            createdAt: new Date(),
            updatedAt: new Date(),
            isPasswordProtected: true,
            notebookId: null,
            createdById: "u1",
          },
        ],
      },
      "Untitled note",
    );

    expect(items.map((i) => [i.kind, i.id, i.allDay])).toEqual([
      ["event", 3, true],
      ["note", 4, true],
      ["task", 1, false],
    ]);
    expect(items.find((i) => i.kind === "note")?.title).toBe("Untitled note");
  });
});

describe("time-grid layout", () => {
  it("widens the hour window to reach items outside the default 08–20", () => {
    expect(hourWindow([])).toEqual({ start: 8, end: 20 });
    expect(hourWindow([task({ date: new Date(2026, 3, 8, 6, 15) })]).start).toBe(6);
    expect(hourWindow([task({ date: new Date(2026, 3, 8, 22, 0) })]).end).toBe(23);
  });

  it("ignores all-day items when sizing the hour window", () => {
    const allDayNote: CalendarItem = {
      kind: "note",
      id: 9,
      title: "n",
      date: new Date(2026, 3, 8, 0, 0),
      allDay: true,
      locked: false,
    };
    expect(hourWindow([allDayNote])).toEqual({ start: 8, end: 20 });
  });

  it("positions blocks against the top of the hour window", () => {
    const [positioned] = layoutTimedItems([task({ date: new Date(2026, 3, 8, 10, 30) })], 8);
    expect(positioned!.top).toBe(Math.round(2.5 * ROW_HEIGHT));
  });

  it("splits overlapping events into side-by-side lanes", () => {
    const positioned = layoutTimedItems(
      [
        event({
          id: 1,
          date: new Date(2026, 3, 8, 9, 0),
          endsAt: new Date(2026, 3, 8, 11, 0),
        }),
        event({
          id: 2,
          date: new Date(2026, 3, 8, 9, 30),
          endsAt: new Date(2026, 3, 8, 10, 0),
        }),
        event({
          id: 3,
          date: new Date(2026, 3, 8, 15, 0),
          endsAt: new Date(2026, 3, 8, 16, 0),
        }),
      ],
      8,
    );

    expect(positioned.map((p) => [p.item.id, p.lane, p.lanes])).toEqual([
      [1, 0, 2],
      [2, 1, 2],
      [3, 0, 1],
    ]);
  });

  it("reuses a lane once the event occupying it has ended", () => {
    // 9–10 and 10–11 do not overlap, so the second belongs in lane 0 too —
    // but 9–11 spans both, which keeps all three in one cluster.
    const positioned = layoutTimedItems(
      [
        event({ id: 1, date: new Date(2026, 3, 8, 9, 0), endsAt: new Date(2026, 3, 8, 11, 0) }),
        event({ id: 2, date: new Date(2026, 3, 8, 9, 0), endsAt: new Date(2026, 3, 8, 10, 0) }),
        event({ id: 3, date: new Date(2026, 3, 8, 10, 0), endsAt: new Date(2026, 3, 8, 11, 0) }),
      ],
      8,
    );

    expect(positioned.map((p) => [p.item.id, p.lane, p.lanes])).toEqual([
      [1, 0, 2],
      [2, 1, 2],
      [3, 1, 2],
    ]);
  });

  it("takes an event's height from its real end", () => {
    const [twoHours] = layoutTimedItems(
      [event({ date: new Date(2026, 3, 8, 9, 0), endsAt: new Date(2026, 3, 8, 11, 0) })],
      8,
    );
    const [halfHour] = layoutTimedItems(
      [event({ date: new Date(2026, 3, 8, 9, 0), endsAt: new Date(2026, 3, 8, 9, 30) })],
      8,
    );

    /* The whole point of the change: a two-hour event and a half-hour event
       are no longer the same box. Every timed item used to be laid out at a
       constant BLOCK_HOURS regardless of duration. */
    expect(twoHours!.height).toBeGreaterThan(halfHour!.height);
    expect(twoHours!.height).toBe(2 * ROW_HEIGHT - 2);
    expect(twoHours!.endKnown).toBe(true);
  });

  it("floors a very short event so it stays readable", () => {
    const [tiny] = layoutTimedItems(
      [event({ date: new Date(2026, 3, 8, 9, 0), endsAt: new Date(2026, 3, 8, 9, 5) })],
      8,
    );
    // 5 minutes would be a 5px sliver; the floor is half an hour.
    expect(tiny!.height).toBe(Math.round(0.5 * ROW_HEIGHT) - 2);
  });

  it("marks an event with no recorded end as an assumption", () => {
    const [unknown] = layoutTimedItems([event({ date: new Date(2026, 3, 8, 9, 0) })], 8);
    // Drawn at an hour, but flagged so the grid can show an open lower edge
    // rather than passing a guess off as a known end.
    expect(unknown!.endKnown).toBe(false);
    expect(unknown!.height).toBe(ROW_HEIGHT - 2);
  });

  it("keeps point-in-time tasks and notes as markers, not hour blocks", () => {
    /* A task's due date and a note's calendar date are instants. Drawing them
       as hour-long blocks made two tasks half an hour apart collide and share
       lanes, which is a claim about duration that the data never made. */
    const positioned = layoutTimedItems(
      [
        task({ id: 1, date: new Date(2026, 3, 8, 9, 0) }),
        task({ id: 2, date: new Date(2026, 3, 8, 9, 30) }),
      ],
      8,
    );

    expect(positioned.map((p) => [p.item.id, p.lane, p.lanes])).toEqual([
      [1, 0, 1],
      [2, 0, 1],
    ]);
    expect(positioned[0]!.height).toBeLessThan(ROW_HEIGHT / 2);
  });
});

describe("range view", () => {
  it("covers every day between the bounds, inclusive", () => {
    const bounds = rangeBounds("2026-04-06", "2026-04-10");
    expect(bounds).not.toBeNull();
    const days = visibleDays("range", new Date(2026, 3, 1), bounds);
    expect(days).toHaveLength(5);
    expect(toYmd(days[0]!)).toBe("2026-04-06");
    expect(toYmd(days[4]!)).toBe("2026-04-10");
  });

  it("reads inverted bounds as the range the user meant", () => {
    const bounds = rangeBounds("2026-04-10", "2026-04-06");
    expect(toYmd(bounds!.from)).toBe("2026-04-06");
    expect(toYmd(bounds!.to)).toBe("2026-04-10");
  });

  it("caps an absurd range rather than building tens of thousands of cells", () => {
    const bounds = rangeBounds("2026-01-01", "2999-01-01");
    expect(visibleDays("range", new Date(2026, 0, 1), bounds)).toHaveLength(MAX_RANGE_DAYS);
  });

  it("is null when a bound is unusable, so the caller can fall back", () => {
    expect(rangeBounds("not-a-date", "2026-04-10")).toBeNull();
  });
});

describe("agenda grouping", () => {
  it("buckets items into the days that hold something, in order", () => {
    const groups = groupByDay([
      task({ id: 1, date: new Date(2026, 3, 9, 15, 0) }),
      task({ id: 2, date: new Date(2026, 3, 8, 9, 0) }),
      event({ id: 3, date: new Date(2026, 3, 8, 17, 0) }),
    ]);

    // Two days, not the three-day span between them: an empty day costs a row
    // in a grid and nothing in a list.
    expect(groups).toHaveLength(2);
    expect(toYmd(groups[0]!.day)).toBe("2026-04-08");
    expect(groups[0]!.items.map((i) => i.id)).toEqual([2, 3]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual([1]);
  });
});
