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
  tasks: TaskRow[];
};

export type CalendarTask = {
  id: number;
  title: string;
  status: string;
  dueDate: Date | string | null;
  projectId: number;
  projectTitle: string | null;
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

/** One day of the momentum strip. */
export type MomentumDay = {
  date: Date;
  count: number;
};

export type Momentum = {
  /** Oldest day first, ending today. */
  bars: MomentumDay[];
  /** Consecutive days with at least one completion, counting back from today. */
  streak: number;
  /**
   * Change in output, last week against the week before, as a percentage.
   * Null when the earlier week is empty — there is no "+∞%".
   */
  pace: number | null;
  /** Completions inside the whole window. */
  total: number;
  today: number;
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
 * How much of the local day has elapsed, 0-1.
 *
 * The workspace ring carries two readings: the outer arc is task completion,
 * the inner one is the day itself. That second arc is what makes an empty
 * dashboard still say something, so it is derived rather than fetched.
 */
export function dayFraction(now: Date): number {
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return Math.min(1, Math.max(0, minutes / 1440));
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

/**
 * Your momentum: the bar strip, the streak and the week-on-week pace.
 *
 * Completion timestamps arrive raw from `progress.getPulse` and are bucketed
 * into *local* days here — the reader's midnight is the only one that matters
 * for "did I finish something today".
 */
export function momentum(
  completions: (Date | string)[],
  now: Date,
  span = 14,
): Momentum {
  const today = startOfDay(now);
  const perDay = new Map<number, number>();

  for (const value of completions) {
    const when = asDate(value);
    if (!when) continue;
    const key = startOfDay(when).getTime();
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const bars: MomentumDay[] = [];
  for (let back = span - 1; back >= 0; back -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - back);
    bars.push({ date, count: perDay.get(date.getTime()) ?? 0 });
  }

  // A streak counts finished days, and today is not finished yet: a day with
  // nothing done *so far* must not read as a broken streak until it is over.
  let streak = 0;
  for (let back = perDay.get(today.getTime()) ? 0 : 1; ; back += 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - back);
    if (!perDay.get(date.getTime())) break;
    streak += 1;
  }

  const half = Math.floor(span / 2);
  const recent = bars.slice(span - half).reduce((n, day) => n + day.count, 0);
  const earlier = bars.slice(span - half * 2, span - half).reduce((n, day) => n + day.count, 0);

  return {
    bars,
    streak,
    pace: earlier === 0 ? null : Math.round(((recent - earlier) / earlier) * 100),
    total: bars.reduce((n, day) => n + day.count, 0),
    today: perDay.get(today.getTime()) ?? 0,
  };
}

/** `2πr` for the two ring radii the design uses. */
export const RING_TASKS = 2 * Math.PI * 82;
export const RING_DAY = 2 * Math.PI * 62;

/**
 * `stroke-dashoffset` for an arc filled to `fraction`, scaled by `progress` so
 * the entrance animation can sweep every ring from empty to its real value.
 */
export function dashOffset(circumference: number, fraction: number, progress = 1): number {
  const filled = Math.min(1, Math.max(0, fraction)) * Math.min(1, Math.max(0, progress));
  return circumference * (1 - filled);
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
