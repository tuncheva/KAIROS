import { describe, expect, it } from "vitest";
import {
  ROW_HEIGHT,
  hourWindow,
  isoWeek,
  layoutTimedItems,
  matchesFilters,
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
    projectTitle: "Kairos",
    ...overrides,
  } satisfies Extract<CalendarItem, { kind: "task" }>;
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
      {
        kind: "event",
        id: 3,
        title: "Launch",
        date: new Date(2026, 3, 8, 10, 0),
        allDay: false,
        description: "",
      },
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
      {
        kind: "event",
        id: 2,
        title: "Demo",
        date: new Date(2026, 3, 8, 10, 0),
        allDay: false,
        description: "Kairos showcase",
      },
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

  it("splits overlapping blocks into side-by-side lanes", () => {
    const positioned = layoutTimedItems(
      [
        task({ id: 1, date: new Date(2026, 3, 8, 9, 0) }),
        task({ id: 2, date: new Date(2026, 3, 8, 9, 30) }),
        task({ id: 3, date: new Date(2026, 3, 8, 15, 0) }),
      ],
      8,
    );

    expect(positioned.map((p) => [p.item.id, p.lane, p.lanes])).toEqual([
      [1, 0, 2],
      [2, 1, 2],
      [3, 0, 1],
    ]);
  });
});
