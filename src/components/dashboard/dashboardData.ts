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

/** Task state as the dashboard labels it — the four badges in the design. */
export type TaskState = "done" | "overdue" | "inProgress" | "todo";

export type WeekDay = {
  /** Local midnight of the day. */
  date: Date;
  count: number;
  isToday: boolean;
};

export type ProjectSummary = {
  id: number;
  title: string | null;
  /** Percentage of tasks completed, 0-100. Null when the project has no tasks. */
  percent: number | null;
  openCount: number;
  health: "onTrack" | "inProgress" | "atRisk" | "empty";
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

export function taskState(task: { status: string; dueDate: Date | string | null }, now: Date): TaskState {
  if (task.status === "completed") return "done";
  const due = asDate(task.dueDate);
  if (due && due < startOfDay(now)) return "overdue";
  if (task.status === "in_progress") return "inProgress";
  return "todo";
}

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
 * Tasks the header list shows: everything overdue, then everything due today.
 * Overdue work is the more urgent of the two, so it leads.
 */
export function todayTasks(tasks: CalendarTask[], now: Date): CalendarTask[] {
  const today = startOfDay(now);
  const relevant = tasks.filter((t) => {
    const due = asDate(t.dueDate);
    if (!due) return false;
    if (isSameDay(due, today)) return true;
    return due < today && t.status !== "completed";
  });

  return relevant.sort((a, b) => {
    const aOverdue = taskState(a, now) === "overdue" ? 0 : 1;
    const bOverdue = taskState(b, now) === "overdue" ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (asDate(a.dueDate)?.getTime() ?? 0) - (asDate(b.dueDate)?.getTime() ?? 0);
  });
}

/**
 * Five weekday columns starting today, weekends skipped — the strip in the
 * design runs THU, FRI, MON, TUE, WED rather than showing empty Sat/Sun.
 */
export function weekStrip(tasks: CalendarTask[], now: Date, columns = 5): WeekDay[] {
  const today = startOfDay(now);
  const days: WeekDay[] = [];
  const cursor = new Date(today);

  while (days.length < columns) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) {
      const date = new Date(cursor);
      days.push({
        date,
        isToday: isSameDay(date, today),
        count: tasks.filter((t) => {
          if (t.status === "completed") return false;
          const due = asDate(t.dueDate);
          return !!due && isSameDay(due, date);
        }).length,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export function projectSummaries(projects: DashboardProject[], now: Date): ProjectSummary[] {
  const today = startOfDay(now);

  const summaries = projects.map((project): ProjectSummary => {
    const total = project.tasks.length;
    const completed = project.tasks.filter((t) => t.status === "completed").length;
    const open = total - completed;
    const hasOverdue = project.tasks.some((t) => {
      if (t.status === "completed") return false;
      const due = asDate(t.dueDate);
      return !!due && due < today;
    });

    if (total === 0) {
      return { id: project.id, title: project.title, percent: null, openCount: 0, health: "empty" };
    }

    const percent = Math.round((completed / total) * 100);
    const health = hasOverdue ? "atRisk" : percent >= 70 ? "onTrack" : "inProgress";

    return { id: project.id, title: project.title, percent, openCount: open, health };
  });

  // Projects with work in them lead; empty ones sink to the bottom of the rail.
  const rank = { atRisk: 0, inProgress: 1, onTrack: 2, empty: 3 } as const;
  return summaries.sort((a, b) => {
    if (rank[a.health] !== rank[b.health]) return rank[a.health] - rank[b.health];
    return b.openCount - a.openCount;
  });
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

/** `2πr` for the three ring radii the design uses. */
export const RING_TASKS = 2 * Math.PI * 82;
export const RING_DAY = 2 * Math.PI * 62;
export const RING_PROJECT = 2 * Math.PI * 19;

/**
 * `stroke-dashoffset` for an arc filled to `fraction`, scaled by `progress` so
 * the entrance animation can sweep every ring from empty to its real value.
 */
export function dashOffset(circumference: number, fraction: number, progress = 1): number {
  const filled = Math.min(1, Math.max(0, fraction)) * Math.min(1, Math.max(0, progress));
  return circumference * (1 - filled);
}
