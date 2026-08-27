/* ------------------------------------------------------------------ */
/*  Shared types, date helpers and colour mapping for the calendar.    */
/*                                                                    */
/*  The redesign is dark-first, but the app is themed: every colour    */
/*  here resolves to a design token so the calendar follows the        */
/*  light/dark theme and the user's accent choice.                    */
/* ------------------------------------------------------------------ */

export type CalendarKind = "task" | "event" | "note";

export type ViewMode = "month" | "week" | "day";

export type CalendarTask = {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | string | null;
  projectId: number;
  projectTitle: string | null;
};

export type CalendarEvent = {
  id: number;
  title: string;
  eventDate: Date | string;
  description: string;
};

export type CalendarNote = {
  id: number;
  title: string | null;
  calendarDate: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  isPasswordProtected: boolean;
  notebookId: number | null;
  createdById: string;
};

export type CalendarData = {
  tasks: CalendarTask[];
  events: CalendarEvent[];
  notes: CalendarNote[];
};

export type CalendarItem =
  | {
      kind: "task";
      id: number;
      title: string;
      date: Date;
      allDay: boolean;
      status: string;
      priority: string;
      projectTitle: string | null;
    }
  | { kind: "event"; id: number; title: string; date: Date; allDay: boolean; description: string }
  | { kind: "note"; id: number; title: string; date: Date; allDay: boolean; locked: boolean };

/* ------------------------------------------------------------------ */
/*  Dates — all arithmetic is local-time, weeks start on Monday.       */
/* ------------------------------------------------------------------ */

export function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
export function endOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
export function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 0, 0, 0, 0);
}
export function startOfWeekMonday(d: Date) {
  const x = startOfDayLocal(d);
  // JS getDay(): Sun=0..Sat=6 → Monday-indexed 0..6.
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function endOfWeekMonday(d: Date) {
  const x = addDays(startOfWeekMonday(d), 6);
  x.setHours(23, 59, 59, 999);
  return x;
}
export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
/** Local-time YYYY-MM-DD — never `toISOString()`, which shifts to UTC. */
export function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function fromYmd(s: string, endOfDay = false): Date | null {
  const parts = s.split("-").map((x) => Number(x));
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const out = endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}
export function toHm(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/** Hours since midnight as a decimal, e.g. 14:30 → 14.5. */
export function decimalHours(d: Date) {
  return d.getHours() + d.getMinutes() / 60;
}

/** ISO-8601 week number, used for the "Week 35 · 2026" sub-title. */
export function isoWeek(d: Date) {
  const x = startOfDayLocal(d);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const firstThursday = new Date(x.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((x.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/** The 42-cell (6×7) Monday-start grid that contains `anchor`'s month. */
export function monthGridDays(anchor: Date) {
  const start = startOfWeekMonday(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The days a view shows: 42 for month, 7 for week, 1 for day. */
export function visibleDays(view: ViewMode, anchor: Date) {
  if (view === "month") return monthGridDays(anchor);
  if (view === "week") {
    const start = startOfWeekMonday(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  return [startOfDayLocal(anchor)];
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/* ------------------------------------------------------------------ */
/*  Item mapping                                                      */
/* ------------------------------------------------------------------ */

/** Entries stored at exactly midnight carry no meaningful time-of-day,
 *  so they render in the all-day strip rather than at 00:00. */
function isAllDay(d: Date) {
  return d.getHours() === 0 && d.getMinutes() === 0;
}

export function toCalendarItems(
  data: CalendarData | undefined,
  untitledNoteLabel: string,
): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const task of data?.tasks ?? []) {
    if (!task.dueDate) continue;
    const date = new Date(task.dueDate);
    items.push({
      kind: "task",
      id: task.id,
      title: task.title,
      date,
      allDay: isAllDay(date),
      status: task.status,
      priority: task.priority,
      projectTitle: task.projectTitle,
    });
  }
  for (const event of data?.events ?? []) {
    const date = new Date(event.eventDate);
    items.push({
      kind: "event",
      id: event.id,
      title: event.title,
      date,
      allDay: isAllDay(date),
      description: event.description,
    });
  }
  for (const note of data?.notes ?? []) {
    if (!note.calendarDate) continue;
    const date = new Date(note.calendarDate);
    items.push({
      kind: "note",
      id: note.id,
      title: note.title ?? untitledNoteLabel,
      date,
      allDay: isAllDay(date),
      locked: note.isPasswordProtected,
    });
  }

  items.sort((a, b) => a.date.getTime() - b.date.getTime());
  return items;
}

export function itemUid(item: Pick<CalendarItem, "kind" | "id">) {
  return `${item.kind}-${item.id}`;
}

/* ------------------------------------------------------------------ */
/*  Filtering                                                         */
/* ------------------------------------------------------------------ */

export type ItemFilters = {
  query: string;
  kinds: Set<CalendarKind>;
  /** Task-only; other kinds ignore these. */
  statuses: Set<string>;
  priorities: Set<string>;
};

/** The free-text haystack for an item — title plus its one extra text field. */
function searchable(item: CalendarItem) {
  if (item.kind === "task") return `${item.title} ${item.projectTitle ?? ""}`;
  if (item.kind === "event") return `${item.title} ${item.description}`;
  return item.title;
}

export function matchesFilters(item: CalendarItem, filters: ItemFilters) {
  if (!filters.kinds.has(item.kind)) return false;

  if (item.kind === "task") {
    if (!filters.statuses.has(item.status)) return false;
    if (!filters.priorities.has(item.priority)) return false;
  }

  const query = filters.query.trim().toLowerCase();
  if (query && !searchable(item).toLowerCase().includes(query)) return false;

  return true;
}

/* ------------------------------------------------------------------ */
/*  Colour tones                                                      */
/*                                                                    */
/*  Tasks take their priority hue (medium = the workspace accent),     */
/*  events are informational, notes are a neutral dashed outline —     */
/*  the same three-way distinction as the redesign.                    */
/* ------------------------------------------------------------------ */

export type Tone = {
  /** Left colour bar on a block. */
  bar: string;
  /** Block fill. */
  bg: string;
  /** Border colour (and style) — pair it with a `border` utility. */
  border: string;
  /** Accompanying text colour. */
  text: string;
  /** Solid swatch, for chips and detail rows. */
  dot: string;
};

const PRIORITY_TONE: Record<string, Tone> = {
  urgent: {
    bar: "bg-error",
    bg: "bg-error/10",
    border: "border-error/30",
    text: "text-error",
    dot: "bg-error",
  },
  high: {
    bar: "bg-warning",
    bg: "bg-warning/10",
    border: "border-warning/30",
    text: "text-warning",
    dot: "bg-warning",
  },
  medium: {
    bar: "bg-accent-primary",
    bg: "bg-accent-primary/10",
    border: "border-accent-primary/30",
    text: "text-accent-primary",
    dot: "bg-accent-primary",
  },
  low: {
    bar: "bg-info",
    bg: "bg-info/10",
    border: "border-info/30",
    text: "text-info",
    dot: "bg-info",
  },
};

const EVENT_TONE: Tone = {
  bar: "bg-info",
  bg: "bg-info/10",
  border: "border-info/30",
  text: "text-info",
  dot: "bg-info",
};

const NOTE_TONE: Tone = {
  bar: "bg-fg-quaternary",
  bg: "bg-transparent",
  border: "border-dashed border-fg-quaternary/45",
  text: "text-fg-secondary",
  dot: "bg-fg-quaternary",
};

export function priorityTone(priority: string): Tone {
  return PRIORITY_TONE[priority] ?? PRIORITY_TONE.medium!;
}

export function toneFor(item: Pick<CalendarItem, "kind"> & { priority?: string }): Tone {
  if (item.kind === "task") return priorityTone(item.priority ?? "medium");
  if (item.kind === "event") return EVENT_TONE;
  return NOTE_TONE;
}

/** Chips and toggles need a filled swatch, so notes get a tinted neutral
 *  instead of the transparent dashed outline their blocks use. */
export const KIND_CHIP_TONE: Record<CalendarKind, Tone> = {
  task: PRIORITY_TONE.medium!,
  event: EVENT_TONE,
  note: {
    bar: "bg-fg-quaternary",
    bg: "bg-fg-quaternary/10",
    border: "border-fg-quaternary/35",
    text: "text-fg-secondary",
    dot: "bg-fg-quaternary",
  },
};

export const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: "statusPending",
  in_progress: "statusInProgress",
  blocked: "statusBlocked",
  completed: "statusCompleted",
};

export const PRIORITY_LABEL_KEYS: Record<string, string> = {
  urgent: "priorityUrgent",
  high: "priorityHigh",
  medium: "priorityMedium",
  low: "priorityLow",
};

export const KIND_LABEL_KEYS: Record<CalendarKind, string> = {
  task: "taskType",
  event: "eventType",
  note: "noteType",
};

export const TASK_STATUSES = ["pending", "in_progress", "blocked", "completed"] as const;
export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const ITEM_KINDS: CalendarKind[] = ["task", "event", "note"];

/* ------------------------------------------------------------------ */
/*  Time-grid geometry                                                */
/* ------------------------------------------------------------------ */

export const ROW_HEIGHT = 56;
/** Default window, widened by `hourWindow` when items fall outside it. */
const DEFAULT_HOUR_START = 8;
const DEFAULT_HOUR_END = 20;

/** The hour range the time grid must cover to show every timed item. */
export function hourWindow(items: CalendarItem[]) {
  let start = DEFAULT_HOUR_START;
  let end = DEFAULT_HOUR_END;
  for (const item of items) {
    if (item.allDay) continue;
    start = Math.min(start, Math.floor(decimalHours(item.date)));
    // Blocks are an hour long, so the window has to reach one hour past.
    end = Math.max(end, Math.ceil(decimalHours(item.date)) + 1);
  }
  return { start: Math.max(0, start), end: Math.min(24, Math.max(end, start + 1)) };
}

export type PositionedItem = {
  item: CalendarItem;
  top: number;
  height: number;
  /** Column index and total columns inside a cluster of overlapping items. */
  lane: number;
  lanes: number;
};

/** Nothing in the schema records a duration, so a timed item occupies an hour. */
const BLOCK_HOURS = 1;

/**
 * Stack overlapping items side by side. The mock had no colliding items;
 * real data does, and fully overlapping blocks would hide each other.
 */
export function layoutTimedItems(items: CalendarItem[], hourStart: number): PositionedItem[] {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  const out: PositionedItem[] = [];

  let cluster: PositionedItem[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const entry of cluster) entry.lanes = cluster.length;
    cluster = [];
  };

  for (const item of sorted) {
    const startHours = decimalHours(item.date);
    const endHours = startHours + BLOCK_HOURS;

    if (startHours >= clusterEnd) flush();

    const entry: PositionedItem = {
      item,
      top: Math.round((startHours - hourStart) * ROW_HEIGHT),
      height: Math.max(44, Math.round(BLOCK_HOURS * ROW_HEIGHT) - 4),
      lane: cluster.length,
      lanes: 1,
    };
    cluster.push(entry);
    out.push(entry);
    clusterEnd = Math.max(clusterEnd, endHours);
  }
  flush();

  return out;
}
