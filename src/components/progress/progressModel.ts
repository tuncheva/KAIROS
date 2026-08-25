/* ------------------------------------------------------------------ */
/*  Shared types, date maths and tones for /progress.                  */
/*                                                                    */
/*  The page is a record of finished work, not a dashboard: everything */
/*  below turns "task X was completed at instant Y" into the shapes    */
/*  the redesign draws — a contribution grid, a streak, a pace, a day  */
/*  log, remaining workload and a leaderboard.                        */
/*                                                                    */
/*  The mock is dark-first with hard-coded hex. The app is themed, so  */
/*  every colour here is a design token and follows both the light /   */
/*  dark theme and the user's accent choice.                          */
/*                                                                    */
/*  All date arithmetic is local-time and weeks start on Monday, the   */
/*  same rules the calendar uses. Never `toISOString()` for a day key: */
/*  it shifts to UTC and moves late-evening completions to tomorrow.   */
/* ------------------------------------------------------------------ */

/** Columns in the contribution grid — 18 weeks, as in the redesign. */
export const RECORD_WEEKS = 18;

/** Days of history to ask the server for: the grid plus a day of slack. */
export const RECORD_DAYS = RECORD_WEEKS * 7 + 7;

export type WindowKey = "week" | "month" | "all";

export const WINDOW_KEYS: WindowKey[] = ["week", "month", "all"];

export function windowLength(key: WindowKey): number {
  if (key === "week") return 7;
  if (key === "month") return 30;
  return RECORD_WEEKS * 7;
}

/* ------------------------------------------------------------------ */
/*  Server payload                                                    */
/* ------------------------------------------------------------------ */

export type RecordEntry = {
  id: number;
  title: string;
  projectId: number;
  projectTitle: string;
  createdAt: Date | string;
  /** When the task was finished. Serialises as a string over the wire. */
  finishedAt: Date | string;
};

export type WorkloadEntry = {
  projectId: number;
  projectTitle: string;
  open: number;
  lastTouchedAt: Date | string | null;
};

export type NextTask = {
  id: number;
  title: string;
  projectId: number;
  projectTitle: string;
  priority: string;
  dueDate: Date | string | null;
  waitingBehind: number;
};

export type LeaderboardPerson = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  completed: number;
  isSelf: boolean;
};

/* ------------------------------------------------------------------ */
/*  Dates                                                             */
/* ------------------------------------------------------------------ */

export function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local-time YYYY-MM-DD, the key every day-bucket is stored under. */
export function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromYmd(ymd: string): Date | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  const out = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** Whole days between two local midnights — positive when `later` is later. */
export function daysBetween(earlier: Date, later: Date) {
  const a = startOfDayLocal(earlier).getTime();
  const b = startOfDayLocal(later).getTime();
  return Math.round((b - a) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/*  Entries                                                           */
/* ------------------------------------------------------------------ */

export type FinishedTask = {
  id: number;
  title: string;
  projectId: number;
  projectTitle: string;
  /** Local day the task landed on. */
  ymd: string;
  finishedAt: Date;
  /** Wall-clock time from creation to completion, in days. */
  tookDays: number;
};

export function normaliseEntries(entries: RecordEntry[] | undefined): FinishedTask[] {
  const out: FinishedTask[] = [];
  for (const entry of entries ?? []) {
    const finishedAt = new Date(entry.finishedAt);
    if (Number.isNaN(finishedAt.getTime())) continue;
    const createdAt = new Date(entry.createdAt);
    const tookMs = Number.isNaN(createdAt.getTime())
      ? 0
      : Math.max(0, finishedAt.getTime() - createdAt.getTime());
    out.push({
      id: entry.id,
      title: entry.title,
      projectId: entry.projectId,
      projectTitle: entry.projectTitle,
      ymd: toYmd(finishedAt),
      finishedAt,
      tookDays: tookMs / 86_400_000,
    });
  }
  out.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
  return out;
}

export function countByDay(tasks: FinishedTask[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.ymd, (counts.get(task.ymd) ?? 0) + 1);
  return counts;
}

export function tasksByDay(tasks: FinishedTask[]): Map<string, FinishedTask[]> {
  const byDay = new Map<string, FinishedTask[]>();
  for (const task of tasks) {
    const bucket = byDay.get(task.ymd);
    if (bucket) bucket.push(task);
    else byDay.set(task.ymd, [task]);
  }
  return byDay;
}

/**
 * A duration the eye can compare at a glance: days once there is at least
 * one, hours below that. The unit is returned separately so the component can
 * translate it instead of baking English into the model.
 */
export function formatTook(tookDays: number): { value: string; unit: "d" | "h" } {
  if (tookDays >= 1) return { value: tookDays.toFixed(1), unit: "d" };
  return { value: String(Math.max(1, Math.round(tookDays * 24))), unit: "h" };
}

/* ------------------------------------------------------------------ */
/*  The contribution grid                                             */
/* ------------------------------------------------------------------ */

/** 0 = nothing finished, 4 = a standout day. Drives the heat ramp. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function heatLevel(count: number): HeatLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/** The accent at rising strength; level 0 is a faint neutral, not an accent. */
const HEAT_CLASS: Record<HeatLevel, string> = {
  0: "bg-fg-primary/[0.07]",
  1: "bg-accent-primary/30",
  2: "bg-accent-primary/55",
  3: "bg-accent-primary/[0.78]",
  4: "bg-accent-primary",
};

export function heatClass(level: HeatLevel): string {
  return HEAT_CLASS[level];
}

export const HEAT_LEGEND: HeatLevel[] = [0, 1, 2, 4];

export type GridDay = {
  ymd: string;
  date: Date;
  count: number;
  level: HeatLevel;
  /** Inside the selected window; outside days are dimmed, not hidden. */
  inWindow: boolean;
  isToday: boolean;
  /** Trailing cells of the current week, which have not happened yet. */
  isFuture: boolean;
};

export type GridWeek = {
  key: string;
  days: GridDay[];
  /** Rendered above the column when a new month starts in it. */
  monthLabel: Date | null;
};

/**
 * A column earns a month tick only when the month actually begins inside it,
 * i.e. its Monday falls in the first week of that month. Labelling on every
 * change of month would tick the very first column too — a partial week left
 * over from the month before — and its label would collide with the real one
 * a column or two later.
 */
function monthTick(monday: Date): Date | null {
  return monday.getDate() <= 7 ? monday : null;
}

/**
 * The grid runs oldest-first, one column per week, Monday at the top. The
 * last column is the week containing `today`, so today sits in its own row
 * position rather than always in the bottom-right corner.
 */
export function buildGrid(args: {
  today: Date;
  counts: Map<string, number>;
  window: WindowKey;
  weeks?: number;
}): GridWeek[] {
  const { today, counts } = args;
  const weekCount = args.weeks ?? RECORD_WEEKS;
  const span = windowLength(args.window);

  const todayYmd = toYmd(today);
  // Monday of the current week, then back to the first column's Monday.
  const thisMonday = addDays(today, -((today.getDay() + 6) % 7));
  const firstMonday = addDays(thisMonday, -(weekCount - 1) * 7);

  const weeks: GridWeek[] = [];

  for (let w = 0; w < weekCount; w++) {
    const monday = addDays(firstMonday, w * 7);
    const days: GridDay[] = [];

    for (let r = 0; r < 7; r++) {
      const date = addDays(monday, r);
      const ymd = toYmd(date);
      const age = daysBetween(date, today);
      const count = counts.get(ymd) ?? 0;
      days.push({
        ymd,
        date,
        count,
        level: heatLevel(count),
        inWindow: age >= 0 && age < span,
        isToday: ymd === todayYmd,
        isFuture: age < 0,
      });
    }

    weeks.push({ key: toYmd(monday), days, monthLabel: monthTick(monday) });
  }

  return weeks;
}

/* ------------------------------------------------------------------ */
/*  Summary numbers                                                   */
/* ------------------------------------------------------------------ */

export type RecordSummary = {
  /** Tasks finished inside the window. */
  finished: number;
  /** Window length in days, for "N a day on average". */
  days: number;
  perDay: string;
  /** Consecutive days with something finished, counting back from today. */
  streak: number;
  bestCount: number;
  bestDay: Date | null;
  thisWeek: number;
  previousWeek: number;
  /** Change against the week before, in percent. Null when there is no base. */
  pacePercent: number | null;
};

export function summarise(args: {
  today: Date;
  counts: Map<string, number>;
  window: WindowKey;
}): RecordSummary {
  const { today, counts } = args;
  const days = windowLength(args.window);

  let finished = 0;
  let bestCount = 0;
  let bestDay: Date | null = null;

  for (let age = 0; age < days; age++) {
    const date = addDays(today, -age);
    const count = counts.get(toYmd(date)) ?? 0;
    finished += count;
    if (count > bestCount) {
      bestCount = count;
      bestDay = date;
    }
  }

  let thisWeek = 0;
  let previousWeek = 0;
  for (let age = 0; age < 14; age++) {
    const count = counts.get(toYmd(addDays(today, -age))) ?? 0;
    if (age < 7) thisWeek += count;
    else previousWeek += count;
  }

  // A quiet today does not break a streak — the day is not over yet. A quiet
  // yesterday does.
  let streak = 0;
  for (let age = 0; age < RECORD_WEEKS * 7; age++) {
    const count = counts.get(toYmd(addDays(today, -age))) ?? 0;
    if (count > 0) streak += 1;
    else if (age > 0) break;
  }

  return {
    finished,
    days,
    perDay: (finished / days).toFixed(1),
    streak,
    bestCount,
    bestDay,
    thisWeek,
    previousWeek,
    pacePercent:
      previousWeek > 0 ? Math.round(((thisWeek - previousWeek) / previousWeek) * 100) : null,
  };
}

/* ------------------------------------------------------------------ */
/*  The day log                                                       */
/* ------------------------------------------------------------------ */

export type LogGroup = { ymd: string; date: Date; items: FinishedTask[] };

/** How many recent days the log shows when no single day is selected. */
const LOG_DAYS = 3;

/**
 * The selected day on its own, or the most recent days inside the window that
 * have anything on them — a log padded with empty days would read as a gap in
 * the record rather than as a quiet weekend.
 */
export function buildLog(args: {
  today: Date;
  tasks: FinishedTask[];
  window: WindowKey;
  selectedYmd: string | null;
}): LogGroup[] {
  const byDay = tasksByDay(args.tasks);

  if (args.selectedYmd) {
    const date = fromYmd(args.selectedYmd);
    const items = byDay.get(args.selectedYmd) ?? [];
    if (!date || !items.length) return [];
    return [{ ymd: args.selectedYmd, date, items }];
  }

  const span = windowLength(args.window);
  const groups: LogGroup[] = [];
  for (let age = 0; age < span && groups.length < LOG_DAYS; age++) {
    const date = addDays(args.today, -age);
    const ymd = toYmd(date);
    const items = byDay.get(ymd);
    if (items?.length) groups.push({ ymd, date, items });
  }
  return groups;
}

export function countLogged(groups: LogGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

/* ------------------------------------------------------------------ */
/*  Suggestions                                                       */
/*                                                                    */
/*  Descriptors, not sentences: the component owns the wording so the  */
/*  copy stays translatable and this stays unit-testable.              */
/* ------------------------------------------------------------------ */

export type Suggestion =
  | {
      id: "pace";
      tone: SuggestionTone;
      direction: "up" | "down";
      percent: number;
      thisWeek: number;
      previousWeek: number;
    }
  | {
      id: "stale";
      tone: SuggestionTone;
      projectId: number;
      projectTitle: string;
      quietDays: number;
      open: number;
    }
  | {
      id: "next";
      tone: SuggestionTone;
      taskId: number;
      title: string;
      projectId: number;
      projectTitle: string;
      priority: string;
      dueDate: Date | null;
      waitingBehind: number;
    };

export type SuggestionTone = "accent" | "warning" | "error" | "info";

/** A project has to be quiet this long before it is worth mentioning. */
const STALE_DAYS = 3;

export function buildSuggestions(args: {
  today: Date;
  summary: RecordSummary;
  workload: WorkloadEntry[];
  nextTask: NextTask | null;
}): Suggestion[] {
  const out: Suggestion[] = [];

  const pace = args.summary.pacePercent;
  if (pace !== null && pace !== 0) {
    out.push({
      id: "pace",
      tone: pace < 0 ? "warning" : "info",
      direction: pace < 0 ? "down" : "up",
      percent: Math.abs(pace),
      thisWeek: args.summary.thisWeek,
      previousWeek: args.summary.previousWeek,
    });
  }

  const stalest = [...args.workload]
    .filter((w) => w.open > 0 && w.lastTouchedAt)
    .map((w) => ({ entry: w, quietDays: daysBetween(new Date(w.lastTouchedAt!), args.today) }))
    .filter((w) => w.quietDays >= STALE_DAYS)
    .sort((a, b) => b.quietDays - a.quietDays)[0];

  if (stalest) {
    out.push({
      id: "stale",
      tone: "error",
      projectId: stalest.entry.projectId,
      projectTitle: stalest.entry.projectTitle,
      quietDays: stalest.quietDays,
      open: stalest.entry.open,
    });
  }

  const next = args.nextTask;
  if (next) {
    out.push({
      id: "next",
      tone: "accent",
      taskId: next.id,
      title: next.title,
      projectId: next.projectId,
      projectTitle: next.projectTitle,
      priority: next.priority,
      dueDate: next.dueDate ? new Date(next.dueDate) : null,
      waitingBehind: next.waitingBehind,
    });
  }

  return out;
}

export const SUGGESTION_TEXT: Record<SuggestionTone, string> = {
  accent: "text-accent-primary",
  warning: "text-warning",
  error: "text-error",
  info: "text-info",
};

export const SUGGESTION_DOT: Record<SuggestionTone, string> = {
  accent: "bg-accent-primary",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
};

/* ------------------------------------------------------------------ */
/*  Project tones                                                     */
/*                                                                    */
/*  Keyed off the project id so a project keeps the same colour in the */
/*  log, the workload bars and anywhere else it appears — and keeps it */
/*  across reloads, which an index-into-a-list palette would not.      */
/* ------------------------------------------------------------------ */

export type ProjectTone = { dot: string; bar: string; text: string };

const PROJECT_TONES: ProjectTone[] = [
  { dot: "bg-brand-purple", bar: "bg-brand-purple", text: "text-brand-purple" },
  { dot: "bg-brand-sky", bar: "bg-brand-sky", text: "text-brand-sky" },
  { dot: "bg-brand-mint", bar: "bg-brand-mint", text: "text-brand-mint" },
  { dot: "bg-brand-caramel", bar: "bg-brand-caramel", text: "text-brand-caramel" },
  { dot: "bg-brand-strawberry", bar: "bg-brand-strawberry", text: "text-brand-strawberry" },
  { dot: "bg-brand-pink", bar: "bg-brand-pink", text: "text-brand-pink" },
];

export function projectTone(projectId: number): ProjectTone {
  const index = Math.abs(projectId) % PROJECT_TONES.length;
  return PROJECT_TONES[index]!;
}

/* ------------------------------------------------------------------ */
/*  Leaderboard                                                       */
/* ------------------------------------------------------------------ */

/** Blocks the leaderboard shows, as in the redesign. */
export const BOARD_SIZE = 5;

/** Tallest bar in the leaderboard, in pixels. */
const BOARD_BAR_MAX = 150;
const BOARD_BAR_MIN = 12;

export type BoardBlock = LeaderboardPerson & {
  initials: string;
  /** Bar height in pixels, proportional to the leader. */
  barHeight: number;
};

/**
 * The caller is always on the board: if they are outside the top five their
 * block replaces the last one, so "where am I" is answerable without paging.
 */
export function buildBoard(people: LeaderboardPerson[], size = BOARD_SIZE): BoardBlock[] {
  const ranked = [...people].sort((a, b) => b.completed - a.completed);
  const shown = ranked.slice(0, size);

  const self = ranked.find((p) => p.isSelf);
  if (self && !shown.some((p) => p.isSelf)) {
    shown[shown.length - 1] = self;
  }

  const leader = ranked[0]?.completed ?? 0;

  return shown.map((person) => ({
    ...person,
    initials: initialsOf(person),
    barHeight:
      leader > 0
        ? Math.max(BOARD_BAR_MIN, Math.round((person.completed / leader) * BOARD_BAR_MAX))
        : BOARD_BAR_MIN,
  }));
}

export function displayName(person: { name: string | null; email: string | null }): string {
  const name = person.name?.trim();
  if (name) return name;
  const email = person.email?.trim();
  if (email) return email.split("@")[0] ?? email;
  return "";
}

export function initialsOf(person: { name: string | null; email: string | null }): string {
  const label = displayName(person);
  const words = label.split(/[\s.]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}
