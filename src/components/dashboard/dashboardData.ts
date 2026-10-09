/**
 * Pure derivations behind the dashboard.
 *
 * The dashboard reads existing endpoints rather than adding a bespoke one, so
 * every number on the page is computed here from the same task rows the
 * projects list already fetches. Keeping it pure keeps it testable and keeps
 * the client component about rendering.
 */

export type TaskRow = {
  id: number;
  status: string;
  dueDate: Date | string | null;
};

export type DashboardProject = {
  id: number;
  title: string | null;
  /** When the project began — the start of its pace line. */
  createdAt?: Date | string | null;
  tasks: TaskRow[];
};

export type CalendarTask = {
  id: number;
  title: string;
  status: string;
  dueDate: Date | string | null;
  projectId: number;
  projectTitle: string | null;
  priority?: string | null;
  assignedToId?: string | null;
};

export type CalendarEvent = {
  id: number;
  title: string;
  eventDate: Date | string | null;
};

/** Where a project sits, read off its completion and its overdue work. */
export type ProjectHealth = "onTrack" | "inProgress" | "atRisk" | "empty";

/** One row of the project status table. */
export type ProjectStatusRow = {
  id: number;
  title: string | null;
  /**
   * The latest due date among the project's open tasks — the design's
   * "Ends 5 Sep". Projects have no deadline column of their own, so the work
   * still outstanding is what dates them; null reads as "no date".
   */
  endsAt: Date | null;
  /** Everyone on the project: its creator first, then its collaborators. */
  owners: ProjectOwner[];
  open: number;
  overdue: number;
  /** Percentage of tasks completed, 0-100. */
  percent: number;
  /**
   * How much of the project's span has passed, 0-100 — from its creation to
   * `endsAt`. Null without an end date: there is no pace to be behind.
   */
  elapsed: number | null;
  health: ProjectHealth;
};

export type ProjectOwner = {
  id: string;
  name: string | null;
  image: string | null;
};

/** What `project.getMyProjects` returns, as the status table needs it. */
export type ProjectWithPeople = DashboardProject & {
  createdByUser?: ProjectOwner | null;
  collaborators?: ProjectOwner[];
};

export const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const asDate = (value: Date | string | null): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export type HeadlineStats = {
  dueToday: number;
  overdue: number;
  openThisWeek: number;
  completed: number;
  totalTasks: number;
  /** Completed share of all tasks, 0-100. */
  percent: number;
  inProgress: number;
  todo: number;
  projectCount: number;
};

export function headlineStats(projects: DashboardProject[], now: Date): HeadlineStats {
  const today = startOfDay(now);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  let dueToday = 0;
  let overdue = 0;
  let openThisWeek = 0;
  let completed = 0;
  let inProgress = 0;
  let todo = 0;
  let totalTasks = 0;

  for (const project of projects) {
    for (const task of project.tasks) {
      totalTasks += 1;
      if (task.status === "completed") {
        completed += 1;
        continue;
      }
      if (task.status === "in_progress") inProgress += 1;
      else todo += 1;

      const due = asDate(task.dueDate);
      if (!due) continue;
      if (due < today) overdue += 1;
      else if (isSameDay(due, today)) {
        dueToday += 1;
        openThisWeek += 1;
      } else if (due < weekEnd) openThisWeek += 1;
    }
  }

  return {
    dueToday,
    overdue,
    openThisWeek,
    completed,
    totalTasks,
    percent: totalTasks === 0 ? 0 : Math.round((completed / totalTasks) * 100),
    inProgress,
    todo,
    projectCount: projects.length,
  };
}

/**
 * The project status table, one row per project.
 *
 * The list in the design carries six readings of a project — who is on it,
 * what is open, what is late, how far along it is, and whether that adds up to
 * healthy — so every one of them is derived here from the same task rows.
 */
export function projectStatusRows(
  projects: ProjectWithPeople[],
  now: Date,
): ProjectStatusRow[] {
  const today = startOfDay(now);

  const rows = projects.map((project): ProjectStatusRow => {
    const total = project.tasks.length;
    let completed = 0;
    let overdue = 0;
    let endsAt: Date | null = null;

    for (const task of project.tasks) {
      if (task.status === "completed") {
        completed += 1;
        continue;
      }
      const due = asDate(task.dueDate);
      if (!due) continue;
      if (due < today) overdue += 1;
      if (!endsAt || due > endsAt) endsAt = due;
    }

    const owners: ProjectOwner[] = [];
    const seen = new Set<string>();
    for (const person of [project.createdByUser, ...(project.collaborators ?? [])]) {
      if (!person || seen.has(person.id)) continue;
      seen.add(person.id);
      owners.push({ id: person.id, name: person.name, image: person.image });
    }

    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
    const startedAt = asDate(project.createdAt ?? null);
    const elapsed =
      startedAt && endsAt && endsAt > startedAt
        ? Math.round(
            Math.min(
              1,
              Math.max(
                0,
                (now.getTime() - startedAt.getTime()) /
                  (endsAt.getTime() - startedAt.getTime()),
              ),
            ) * 100,
          )
        : null;
    const health =
      total === 0
        ? "empty"
        : overdue > 0
          ? "atRisk"
          : percent >= 70
            ? "onTrack"
            : "inProgress";

    return {
      id: project.id,
      title: project.title,
      endsAt,
      owners,
      open: total - completed,
      overdue,
      percent,
      elapsed,
      health,
    };
  });

  // Same order as the projects rail it replaces: whatever needs attention
  // leads, empty projects sink.
  const rank = { atRisk: 0, inProgress: 1, onTrack: 2, empty: 3 } as const;
  return rows.sort((a, b) => {
    if (rank[a.health] !== rank[b.health]) return rank[a.health] - rank[b.health];
    return b.open - a.open;
  });
}

/** Lower is more urgent; unknown priorities sit with medium. */
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * What to do next: the reader's open, dated tasks, earliest due first (so
 * anything overdue leads), priority breaking ties within a day.
 *
 * Tasks assigned to someone else are never offered. Unassigned ones are, but
 * only to fill the list once the reader's own run out — on a team that does not
 * assign work, the list would otherwise always be empty.
 */
export function nextUp(
  tasks: CalendarTask[],
  userId: string | null,
  limit = 3,
): CalendarTask[] {
  const dated = tasks
    .filter((task) => task.status !== "completed" && asDate(task.dueDate))
    .sort((a, b) => {
      const dayA = startOfDay(asDate(a.dueDate)!).getTime();
      const dayB = startOfDay(asDate(b.dueDate)!).getTime();
      if (dayA !== dayB) return dayA - dayB;
      const rankA = PRIORITY_RANK[a.priority ?? "medium"] ?? 2;
      const rankB = PRIORITY_RANK[b.priority ?? "medium"] ?? 2;
      return rankA - rankB || a.id - b.id;
    });

  if (!userId) return dated.slice(0, limit);
  const mine = dated.filter((task) => task.assignedToId === userId);
  const open = dated.filter((task) => !task.assignedToId);
  return [...mine, ...open].slice(0, limit);
}

/** One day of the week strip. */
export type WeekDay = {
  date: Date;
  /** Tasks due that day, finished or not. */
  total: number;
  /** Of those, still open. */
  open: number;
  events: number;
  isToday: boolean;
  isPast: boolean;
};

/** Monday to Sunday of the week `now` falls in. */
export function weekStrip(
  tasks: CalendarTask[],
  events: CalendarEvent[],
  now: Date,
): WeekDay[] {
  const today = startOfDay(now);
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    const onDay = (value: Date | string | null) => {
      const d = asDate(value);
      return !!d && isSameDay(d, date);
    };
    const due = tasks.filter((task) => onDay(task.dueDate));

    return {
      date,
      total: due.length,
      open: due.filter((task) => task.status !== "completed").length,
      events: events.filter((event) => onDay(event.eventDate)).length,
      isToday: date.getTime() === today.getTime(),
      isPast: date < today,
    };
  });
}

/**
 * Tasks finished in the last seven days against the seven before. Rolling
 * rather than calendar weeks, so Monday morning does not read as a collapse.
 */
export function weekOutput(
  completions: (Date | string)[],
  now: Date,
): { thisWeek: number; lastWeek: number } {
  const today = startOfDay(now).getTime();
  const weekStart = today - 6 * 86_400_000;
  const lastStart = weekStart - 7 * 86_400_000;
  let thisWeek = 0;
  let lastWeek = 0;

  for (const value of completions) {
    const when = asDate(value);
    if (!when) continue;
    const day = startOfDay(when).getTime();
    if (day > today) continue;
    if (day >= weekStart) thisWeek += 1;
    else if (day >= lastStart) lastWeek += 1;
  }

  return { thisWeek, lastWeek };
}

/** Whole days between a past due date and today; 0 for today or later. */
export function daysLate(value: Date | string | null, now: Date): number {
  const due = asDate(value);
  if (!due) return 0;
  const diff = startOfDay(now).getTime() - startOfDay(due).getTime();
  return Math.max(0, Math.round(diff / 86_400_000));
}

/**
 * When a scheduled agent next runs: the first `hourLocal`:00 after `now`, on
 * `dayOfWeek` (0 = Sunday) when it has one. Read in the browser's zone, which is
 * the zone the schedule's hour was set in for anyone using the app where they live.
 */
export function nextRunAt(
  hourLocal: number,
  dayOfWeek: number | null,
  now: Date,
): Date {
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const at = startOfDay(now);
    at.setDate(at.getDate() + ahead);
    at.setHours(hourLocal, 0, 0, 0);
    if (at <= now) continue;
    if (dayOfWeek === null || at.getDay() === dayOfWeek) return at;
  }
  // Unreachable: some day in the next eight matches any weekday.
  return now;
}

/**
 * Compact age stamp — `now`, `20m`, `3h`, `1d` — for the mono accents the
 * design uses wherever it prints a time: the radar's last check, a teammate's
 * last sign of life, an activity row.
 */
export function relativeShort(value: Date | string | null, now: Date): string {
  const then = asDate(value);
  if (!then) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
