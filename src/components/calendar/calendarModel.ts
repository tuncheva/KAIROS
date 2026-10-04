/* ------------------------------------------------------------------ */
/*  Shared types, date helpers and colour mapping for the calendar.    */
/*                                                                    */
/*  The redesign is dark-first, but the app is themed: every colour    */
/*  here resolves to a design token so the calendar follows the        */
/*  light/dark theme and the user's accent choice.                    */
/* ------------------------------------------------------------------ */

export type CalendarKind = "task" | "event" | "note" | "external";

/**
 * The period on screen.
 *
 * `range` is the old pair of date inputs, folded in as a view. It used to be a
 * second, parallel mechanism that narrowed *within* whichever period was
 * loaded — so a range outside that period emptied the grid with no
 * explanation, and any navigation silently discarded it. As a view it is one
 * model of time instead of two: the range *is* the period.
 */
export type ViewMode = "month" | "week" | "day" | "range";

/** Whether the period is drawn as a grid or listed as an agenda. Independent
 *  of `ViewMode` — an agenda of a week and a grid of a week show the same days. */
export type Layout = "grid" | "agenda";

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
  /** `events.ends_at`. Nullable in the schema, so duration is often unknown. */
  endsAt: Date | string | null;
  description: string;
};

/**
 * An event read from a connected calendar.
 *
 * Deliberately a separate kind rather than folded into `CalendarEvent`. It is
 * read-only here — Kairos does not own it, cannot reschedule it, and must not
 * offer to — and it carries `allDay` as a *fact* from the provider rather than
 * the midnight heuristic the product's own rows are read with.
 */
export type CalendarExternalEvent = {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date | string;
  endsAt: Date | string | null;
  allDay: boolean;
  status: string;
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
  external: CalendarExternalEvent[];
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
      /** Needed to link out to the parent project from the detail panel. */
      projectId: number;
      projectTitle: string | null;
    }
  | {
      kind: "event";
      id: number;
      title: string;
      date: Date;
      allDay: boolean;
      /** `null` when the row has no end recorded — the duration is unknown,
       *  which the time grid shows rather than inventing a length. */
      endsAt: Date | null;
      description: string;
    }
  | { kind: "note"; id: number; title: string; date: Date; allDay: boolean; locked: boolean }
  | {
      kind: "external";
      id: number;
      title: string;
      date: Date;
      allDay: boolean;
      endsAt: Date | null;
      description: string;
      location: string | null;
      /** `confirmed` or `tentative`; cancelled rows never reach the client. */
      status: string;
    };

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

/** A range view is capped so a mistyped year cannot ask for 40,000 cells. */
export const MAX_RANGE_DAYS = 92;

/** The days a view shows: 42 for month, 7 for week, 1 for day, and for a
 *  range every day it covers, inclusive. */
export function visibleDays(view: ViewMode, anchor: Date, range?: RangeBounds | null) {
  if (view === "month") return monthGridDays(anchor);
  if (view === "week") {
    const start = startOfWeekMonday(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  if (view === "range" && range) {
    const start = startOfDayLocal(range.from);
    const span = Math.floor((startOfDayLocal(range.to).getTime() - start.getTime()) / 86_400_000);
    const length = Math.min(Math.max(span, 0) + 1, MAX_RANGE_DAYS);
    return Array.from({ length }, (_, i) => addDays(start, i));
  }
  return [startOfDayLocal(anchor)];
}

export type RangeBounds = { from: Date; to: Date };

/** Parse the two range inputs into ordered bounds, or `null` if unusable.
 *  Inverted input is read as the range the user meant, not an error. */
export function rangeBounds(from: string, to: string): RangeBounds | null {
  const a = fromYmd(from);
  const b = fromYmd(to, true);
  if (!a || !b) return null;
  return a <= b ? { from: a, to: b } : { from: startOfDayLocal(b), to: endOfDayLocal(a) };
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
      projectId: task.projectId,
      projectTitle: task.projectTitle,
    });
  }
  for (const event of data?.events ?? []) {
    const date = new Date(event.eventDate);
    const end = event.endsAt ? new Date(event.endsAt) : null;
    items.push({
      kind: "event",
      id: event.id,
      title: event.title,
      date,
      allDay: isAllDay(date),
      // Guard against a stored end that precedes its start: treat it as
      // unknown rather than laying out a negative-height block.
      endsAt: end && !Number.isNaN(end.getTime()) && end > date ? end : null,
      description: event.description,
    });
  }
  for (const external of data?.external ?? []) {
    const date = new Date(external.startsAt);
    const end = external.endsAt ? new Date(external.endsAt) : null;
    items.push({
      kind: "external",
      id: external.id,
      title: external.title,
      date,
      // The provider said so. A date-only event is genuinely all-day; a timed
      // one that happens to start at midnight is not, which is exactly the case
      // the midnight heuristic gets wrong for imported rows.
      allDay: external.allDay,
      endsAt: end && !Number.isNaN(end.getTime()) && end > date ? end : null,
      description: external.description ?? "",
      location: external.location,
      status: external.status,
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
  if (item.kind === "external")
    return `${item.title} ${item.description} ${item.location ?? ""}`;
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

/**
 * An imported event reads as an event — it is one — but at a lower contrast,
 * because it is the one kind on the grid the user cannot act on from here.
 */
const EXTERNAL_TONE: Tone = {
  bar: "bg-info/60",
  bg: "bg-info/[0.06]",
  border: "border-info/20",
  text: "text-info/80",
  dot: "bg-info/60",
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
  if (item.kind === "external") return EXTERNAL_TONE;
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
  external: EXTERNAL_TONE,
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
  external: "externalType",
};

/**
 * A second, non-colour channel for item kind.
 *
 * Tint alone carried this, which fails as soon as colour does: greyscale, low
 * vision, or an accent the user picked that happens to land on the same hue as
 * a priority. These are glyphs rather than icon components on purpose — they
 * have to render inside a 3px-padded chip in a 45px month cell, where an SVG
 * at a legible size does not fit. They are `aria-hidden`; the accessible name
 * always spells the kind out in words.
 */
export const KIND_GLYPH: Record<CalendarKind, string> = {
  task: "✓",
  event: "●",
  note: "▪",
  external: "◇",
};

export const TASK_STATUSES = ["pending", "in_progress", "blocked", "completed"] as const;
export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const ITEM_KINDS: CalendarKind[] = ["task", "event", "note", "external"];

/* ------------------------------------------------------------------ */
/*  Time-grid geometry                                                */
/* ------------------------------------------------------------------ */

export const ROW_HEIGHT = 56;
/** Default window, widened by `hourWindow` when items fall outside it. */
const DEFAULT_HOUR_START = 8;
const DEFAULT_HOUR_END = 20;

/** Smallest span an event may draw at, so a 10-minute slot stays readable. */
const MIN_EVENT_MINUTES = 30;
/** What an event with no recorded end draws at — paired with a dashed lower
 *  edge in the grid, so an assumed length never passes for a known one. */
const ASSUMED_EVENT_MINUTES = 60;
/** Tasks and notes are moments, not spans: they get a marker, not a block. */
const MARKER_MINUTES = 24;

/**
 * How many minutes an item occupies on the time grid, and whether that came
 * from the data or from us.
 *
 * Only events can have a duration — `events.ends_at`. A task's due date and a
 * note's calendar date are instants, and drawing them as hour-long blocks (as
 * this grid used to, for everything) is the one claim a time grid should never
 * make: it puts a 15-minute stand-up and a full-day workshop in identical
 * boxes.
 */
export function itemSpan(item: CalendarItem): { minutes: number; known: boolean } {
  if (item.kind !== "event" && item.kind !== "external")
    return { minutes: MARKER_MINUTES, known: true };
  if (!item.endsAt) return { minutes: ASSUMED_EVENT_MINUTES, known: false };
  const minutes = (item.endsAt.getTime() - item.date.getTime()) / 60_000;
  return { minutes: Math.max(minutes, MIN_EVENT_MINUTES), known: true };
}

/** End of an item's visual span, in decimal hours from midnight. */
function spanEndHours(item: CalendarItem) {
  return decimalHours(item.date) + itemSpan(item).minutes / 60;
}

/** The hour range the time grid must cover to show every timed item. */
export function hourWindow(items: CalendarItem[]) {
  let start = DEFAULT_HOUR_START;
  let end = DEFAULT_HOUR_END;
  for (const item of items) {
    if (item.allDay) continue;
    start = Math.min(start, Math.floor(decimalHours(item.date)));
    // Reach past the item's real end, not a blanket hour.
    end = Math.max(end, Math.ceil(spanEndHours(item)));
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
  /** False when the height is an assumption, not a recorded end. */
  endKnown: boolean;
};

/**
 * Stack overlapping items side by side.
 *
 * Two passes over each cluster of mutually overlapping items: lanes are handed
 * out greedily to the first one that has come free, and only once the cluster
 * closes is the column count known — so every block in a cluster is the same
 * width and none of them hide each other.
 */
export function layoutTimedItems(items: CalendarItem[], hourStart: number): PositionedItem[] {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  const out: PositionedItem[] = [];

  /** Entries in the cluster being built, and when each lane frees up. */
  let cluster: PositionedItem[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const entry of cluster) entry.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const startHours = decimalHours(item.date);
    const span = itemSpan(item);
    const endHours = startHours + span.minutes / 60;

    // A gap with nothing spanning it ends the cluster: what follows cannot
    // overlap anything before it, so it should get the full column width.
    if (startHours >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((freeAt) => freeAt <= startHours);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endHours);
    } else {
      laneEnds[lane] = endHours;
    }

    const entry: PositionedItem = {
      item,
      top: Math.round((startHours - hourStart) * ROW_HEIGHT),
      height: Math.max(20, Math.round((span.minutes / 60) * ROW_HEIGHT) - 2),
      lane,
      lanes: 1,
      endKnown: span.known,
    };
    cluster.push(entry);
    out.push(entry);
    clusterEnd = Math.max(clusterEnd, endHours);
  }
  closeCluster();

  return out;
}

/* ------------------------------------------------------------------ */
/*  Agenda                                                            */
/* ------------------------------------------------------------------ */

/**
 * Items bucketed into the days they fall on, in chronological order.
 *
 * The agenda view lists only the days that hold something, which is the whole
 * point of it on a phone — an empty Tuesday costs a row in a grid and nothing
 * in a list.
 */
export function groupByDay(items: CalendarItem[]): { day: Date; items: CalendarItem[] }[] {
  const buckets = new Map<string, { day: Date; items: CalendarItem[] }>();
  for (const item of items) {
    const key = dayKey(item.date);
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(item);
    else buckets.set(key, { day: startOfDayLocal(item.date), items: [item] });
  }
  return [...buckets.values()]
    .sort((a, b) => a.day.getTime() - b.day.getTime())
    .map((bucket) => ({
      day: bucket.day,
      items: bucket.items.sort((a, b) => a.date.getTime() - b.date.getTime()),
    }));
}
