/**
 * Derivations for the projects page.
 *
 * The page is a browse surface: a list of projects that can be searched,
 * filtered, sorted and opened. All of that is arithmetic over what
 * `project.getMyProjects` already returns, so it lives here as pure functions
 * rather than inside the component — the component then only decides what to
 * paint.
 *
 * Health, the filter buckets and the sort orders are one vocabulary shared by
 * the list, the grid, the detail header and the filter counts. Keeping them in
 * one place is what stops a project reading "On track" in the list and
 * "In progress" on its own page.
 */

/** Where a project sits, read off completion alone. */
export type Health = "empty" | "complete" | "onTrack" | "inProgress" | "atRisk";

/** The four buckets above the list. `atRisk` is the catch-all for attention. */
export type FilterKey = "all" | "track" | "risk" | "done";

export type SortKey = "updated" | "progress" | "name";

export type ViewMode = "list" | "grid";

export interface Person {
  id: string;
  name: string | null;
  image: string | null;
}

/** The shape this module needs from `project.getMyProjects`. */
export interface RawProject {
  id: number;
  title: string;
  description: string | null;
  createdById: string;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  tasks?: { status: string }[];
  collaborators?: Person[];
}

export interface ProjectRow {
  id: number;
  title: string;
  description: string;
  createdById: string;
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  /** Completion, 0–100. Zero when the project has no tasks. */
  percent: number;
  health: Health;
  people: Person[];
  /** Whole days since the last update, for the `updated` sort and the stamp. */
  ageDays: number;
  updatedAt: Date | null;
}

const DAY_MS = 86_400_000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Health from completion. A project with no tasks is `empty` rather than 0% —
 * a fresh project is not failing, and painting it red said it was.
 */
export function health(percent: number, total: number): Health {
  if (total === 0) return "empty";
  if (percent >= 100) return "complete";
  if (percent >= 60) return "onTrack";
  if (percent >= 30) return "inProgress";
  return "atRisk";
}

export function projectRows(projects: RawProject[], now: Date): ProjectRow[] {
  return projects.map((project) => {
    const tasks = project.tasks ?? [];
    const done = tasks.filter((task) => task.status === "completed").length;
    const inProgress = tasks.filter((task) => task.status === "in_progress").length;
    const total = tasks.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const updatedAt = toDate(project.updatedAt) ?? toDate(project.createdAt);

    return {
      id: project.id,
      title: (project.title ?? "").trim(),
      description: (project.description ?? "").trim(),
      createdById: project.createdById,
      total,
      done,
      inProgress,
      todo: total - done - inProgress,
      percent,
      health: health(percent, total),
      people: project.collaborators ?? [],
      ageDays: updatedAt
        ? Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / DAY_MS))
        : Number.MAX_SAFE_INTEGER,
      updatedAt,
    };
  });
}

/**
 * `risk` deliberately catches empty projects as well as behind ones. The bucket
 * answers "what needs me", and a project nobody has put a task in needs the
 * same nudge as one that has stalled.
 */
export function matchesFilter(row: ProjectRow, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "done":
      return row.health === "complete";
    case "track":
      return row.health === "onTrack";
    case "risk":
      return row.health === "empty" || row.health === "inProgress" || row.health === "atRisk";
  }
}

function matchesQuery(row: ProjectRow, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.title.toLowerCase().includes(needle) ||
    row.description.toLowerCase().includes(needle)
  );
}

export function visibleRows(
  rows: ProjectRow[],
  { query, filter, sort }: { query: string; filter: FilterKey; sort: SortKey },
): ProjectRow[] {
  const kept = rows.filter((row) => matchesFilter(row, filter) && matchesQuery(row, query));

  const sorted = [...kept];
  if (sort === "progress") sorted.sort((a, b) => b.percent - a.percent);
  else if (sort === "name") sorted.sort((a, b) => a.title.localeCompare(b.title));
  else sorted.sort((a, b) => a.ageDays - b.ageDays);

  return sorted;
}

export interface WorkspaceTotals {
  /** Projects with tasks that are not finished — the ones actually in flight. */
  active: number;
  tasks: number;
  completed: number;
  percent: number;
}

export function workspaceTotals(rows: ProjectRow[]): WorkspaceTotals {
  const tasks = rows.reduce((sum, row) => sum + row.total, 0);
  const completed = rows.reduce((sum, row) => sum + row.done, 0);
  return {
    active: rows.filter((row) => row.total > 0 && row.percent < 100).length,
    tasks,
    completed,
    percent: tasks > 0 ? Math.round((completed / tasks) * 100) : 0,
  };
}

/* ------------------------------------------------------------------ timeline */

/**
 * What a timeline entry is about. The activity log records task mutations only,
 * so these four are the whole vocabulary — there is no comment or file stream
 * to filter on, and offering those tabs would have shown four empty ones.
 */
export type EventKind = "task" | "status" | "note" | "due";

export type TimelineFilter = "all" | EventKind;

export interface ActivityRow {
  id: number;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date | string | null;
  taskTitle: string | null;
  user: { id: string | null; name: string | null; email: string | null } | null;
}

export interface UpcomingTask {
  id: number;
  title: string;
  status: string;
  priority?: string | null;
  dueDate: Date | string | null;
  assignee?: { name: string | null } | null;
}

export interface TimelineEvent {
  key: string;
  kind: EventKind;
  /** Future entries render dimmed above the "now" marker. */
  future: boolean;
  at: Date;
  /** Who acted, or what is due. */
  actor: string;
  /** Message key under `projects.timeline.verbs`. */
  verb: string;
  target: string;
  /** Secondary line — the old → new value, the assignee, the priority. */
  detail: string;
}

/** Task status → the label the timeline shows for a move. */
function statusLabel(value: string | null): string {
  return (value ?? "").trim();
}

/**
 * One activity row → one timeline entry.
 *
 * `status_changed` splits: a move *to* completed is the thing people look for,
 * so it reads as a completion rather than as another status change buried among
 * them.
 */
export function toTimelineEvent(row: ActivityRow, fallbackActor: string): TimelineEvent | null {
  const at = toDate(row.createdAt);
  if (!at) return null;

  const actor = row.user?.name ?? row.user?.email ?? fallbackActor;
  const target = row.taskTitle ?? "";
  const from = statusLabel(row.oldValue);
  const to = statusLabel(row.newValue);

  let kind: EventKind = "task";
  let verb = "updated";
  let detail = "";

  if (row.action === "created") {
    verb = "created";
  } else if (row.action === "status_changed") {
    if (to === "completed") {
      verb = "completed";
      detail = from ? from : "";
    } else {
      kind = "status";
      verb = "moved";
      detail = from && to ? `${from} → ${to}` : to;
    }
  } else if (row.action === "completion_note_set") {
    kind = "note";
    verb = "noted";
    detail = row.newValue?.trim() ?? "";
  } else if (row.action === "deleted") {
    verb = "deleted";
  }

  return {
    key: `activity-${row.id}`,
    kind,
    future: false,
    at,
    actor,
    verb,
    target,
    detail,
  };
}

/**
 * Tasks due from now on, newest deadline first so the timeline reads downward
 * into the present. Completed tasks are dropped — a deadline that has already
 * been met is not something still coming.
 */
export function upcomingEvents(
  tasks: UpcomingTask[],
  now: Date,
  limit = 4,
): TimelineEvent[] {
  return tasks
    .filter((task) => task.status !== "completed")
    .map((task) => ({ task, due: toDate(task.dueDate) }))
    .filter((entry): entry is { task: UpcomingTask; due: Date } => entry.due !== null)
    .filter((entry) => entry.due.getTime() > now.getTime())
    .sort((a, b) => b.due.getTime() - a.due.getTime())
    .slice(0, limit)
    .map(({ task, due }) => ({
      key: `due-${task.id}`,
      kind: "due" as EventKind,
      future: true,
      at: due,
      actor: task.title,
      verb: "isDue",
      target: "",
      detail: task.assignee?.name ?? "",
    }));
}

export function matchesTimelineFilter(event: TimelineEvent, filter: TimelineFilter): boolean {
  return filter === "all" || event.kind === filter;
}

/** Same calendar day, local time. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Whether an entry belongs to the "recent" head of the timeline. The tail is
 * collapsed behind a toggle so a long-running project does not open onto three
 * months of history.
 */
export function isRecent(event: TimelineEvent, now: Date): boolean {
  const yesterday = new Date(now.getTime() - DAY_MS);
  return isSameDay(event.at, now) || isSameDay(event.at, yesterday);
}
