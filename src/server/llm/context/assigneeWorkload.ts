/**
 * How busy each candidate assignee is — across every project, not just this one.
 *
 * A2 used to see only the tasks of the project it was planning, so "assign this
 * to whoever has room" was answered from a keyhole: someone with two tasks here
 * and thirty elsewhere looked free. This gathers each candidate's load and recent
 * activity org-wide so the planner can pick someone who actually has capacity.
 *
 * Privacy: a candidate's work in projects the *caller* cannot read is reported
 * only as counts, never titles or project names. The caller learns "Bob has 9
 * open tasks in other projects", which is what a reasonable assignment needs, and
 * nothing about what those projects are.
 *
 * Counting happens in Postgres and the labelling in `summarizeWorkload`, so the
 * model gets a verdict ("heavy") rather than rows to add up.
 */

import "server-only";

import { and, gte, inArray, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { taskActivityLog, taskComments, tasks } from "~/server/db/schema";

/** Window for "recently active" and "recently completed". */
export const ACTIVITY_WINDOW_DAYS = 14;
/** More candidates than this and the pack stops being worth its tokens. */
const MAX_CANDIDATES = 50;

export type LoadLevel = "light" | "moderate" | "heavy";

export interface AssigneeWorkload {
  userId: string;
  name: string | null;
  /** Open (not completed) tasks across all projects. */
  openTasks: number;
  inProgress: number;
  overdue: number;
  /** Open tasks due within the next 7 days. */
  dueThisWeek: number;
  /** Open tasks at high or urgent priority. */
  highPriorityOpen: number;
  /** Open tasks in the project being planned. */
  openInThisProject: number;
  /** Open tasks in other projects the caller can see, by title. */
  otherVisibleProjects: Array<{ projectTitle: string; openTasks: number }>;
  /** Open tasks in projects the caller cannot see — a count only. */
  openInOtherProjectsNotVisible: number;
  completedLast14Days: number;
  /** Task edits, status changes and comments in the last 14 days. */
  actionsLast14Days: number;
  lastActiveAt: string | null;
  loadLevel: LoadLevel;
  /** True when there has been no activity in the window at all. */
  possiblyUnavailable: boolean;
}

export interface WorkloadTaskRow {
  assignedToId: string;
  projectId: number;
  open: number;
  inProgress: number;
  overdue: number;
  dueThisWeek: number;
  highPriorityOpen: number;
  completedRecently: number;
}

export interface WorkloadActivityRow {
  userId: string;
  actions: number;
  lastActiveAt: Date | null;
}

/**
 * A rough capacity verdict. Overdue work weighs double: it is a person already
 * behind, and another task makes that worse, not just bigger.
 */
export function loadLevelFor(row: {
  openTasks: number;
  overdue: number;
  highPriorityOpen: number;
}): LoadLevel {
  const score = row.openTasks + row.overdue * 2 + row.highPriorityOpen;
  if (score >= 15) return "heavy";
  if (score >= 6) return "moderate";
  return "light";
}

/** Pure shaping step — kept apart from the queries so it can be tested. */
export function summarizeWorkload(input: {
  candidates: Array<{ id: string; name: string | null }>;
  taskRows: WorkloadTaskRow[];
  activityRows: WorkloadActivityRow[];
  currentProjectId?: number;
  visibleTitleById: Map<number, string>;
}): AssigneeWorkload[] {
  const activityByUser = new Map(input.activityRows.map((r) => [r.userId, r]));

  const result = input.candidates.map((c): AssigneeWorkload => {
    const rows = input.taskRows.filter((r) => r.assignedToId === c.id);
    const sum = (pick: (r: WorkloadTaskRow) => number) =>
      rows.reduce((n, r) => n + pick(r), 0);

    const otherVisibleProjects: AssigneeWorkload["otherVisibleProjects"] = [];
    let openInOtherProjectsNotVisible = 0;
    let openInThisProject = 0;
    for (const r of rows) {
      if (!r.open) continue;
      if (r.projectId === input.currentProjectId) {
        openInThisProject += r.open;
        continue;
      }
      const title = input.visibleTitleById.get(r.projectId);
      if (title === undefined) openInOtherProjectsNotVisible += r.open;
      else otherVisibleProjects.push({ projectTitle: title, openTasks: r.open });
    }
    otherVisibleProjects.sort((a, b) => b.openTasks - a.openTasks);

    const activity = activityByUser.get(c.id);
    const actions = activity?.actions ?? 0;
    const openTasks = sum((r) => r.open);
    const overdue = sum((r) => r.overdue);
    const highPriorityOpen = sum((r) => r.highPriorityOpen);

    return {
      userId: c.id,
      name: c.name,
      openTasks,
      inProgress: sum((r) => r.inProgress),
      overdue,
      dueThisWeek: sum((r) => r.dueThisWeek),
      highPriorityOpen,
      openInThisProject,
      otherVisibleProjects,
      openInOtherProjectsNotVisible,
      completedLast14Days: sum((r) => r.completedRecently),
      actionsLast14Days: actions,
      lastActiveAt: activity?.lastActiveAt?.toISOString() ?? null,
      loadLevel: loadLevelFor({ openTasks, overdue, highPriorityOpen }),
      possiblyUnavailable:
        actions === 0 && sum((r) => r.completedRecently) === 0,
    };
  });

  // Lightest first: the top of the list is the natural first pick.
  return result.sort(
    (a, b) =>
      levelRank(a.loadLevel) - levelRank(b.loadLevel) || a.openTasks - b.openTasks,
  );
}

function levelRank(level: LoadLevel): number {
  return level === "light" ? 0 : level === "moderate" ? 1 : 2;
}

/**
 * Load the workload of each candidate across every project they are assigned in.
 *
 * @param visibleTitleById - Projects the caller may read. Anything outside it is
 *   reduced to a count; see the privacy note at the top of this file.
 */
export async function loadAssigneeWorkload(
  ctx: TRPCContext,
  input: {
    candidates: Array<{ id: string; name: string | null }>;
    currentProjectId?: number;
    visibleTitleById: Map<number, string>;
  },
): Promise<AssigneeWorkload[]> {
  const candidates = input.candidates.slice(0, MAX_CANDIDATES);
  if (!candidates.length) return [];
  const ids = candidates.map((c) => c.id);

  const now = new Date();
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000);
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  const [taskRows, editRows, commentRows] = await Promise.all([
    ctx.db
      .select({
        assignedToId: sql<string>`${tasks.assignedToId}`,
        projectId: tasks.projectId,
        open: sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'completed')`.mapWith(Number),
        inProgress: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'in_progress')`.mapWith(Number),
        overdue: sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'completed' AND ${tasks.dueDate} < ${now})`.mapWith(Number),
        dueThisWeek: sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'completed' AND ${tasks.dueDate} >= ${now} AND ${tasks.dueDate} <= ${weekAhead})`.mapWith(Number),
        highPriorityOpen: sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'completed' AND ${tasks.priority} IN ('high', 'urgent'))`.mapWith(Number),
        completedRecently: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'completed' AND ${tasks.completedAt} >= ${since})`.mapWith(Number),
      })
      .from(tasks)
      .where(inArray(tasks.assignedToId, ids))
      .groupBy(tasks.assignedToId, tasks.projectId),
    ctx.db
      .select({
        userId: taskActivityLog.userId,
        actions: sql<number>`count(*)`.mapWith(Number),
        lastActiveAt: sql<Date | null>`max(${taskActivityLog.createdAt})`.mapWith(
          (v: string | Date | null) => (v ? new Date(v) : null),
        ),
      })
      .from(taskActivityLog)
      .where(and(inArray(taskActivityLog.userId, ids), gte(taskActivityLog.createdAt, since)))
      .groupBy(taskActivityLog.userId),
    ctx.db
      .select({
        userId: taskComments.createdById,
        actions: sql<number>`count(*)`.mapWith(Number),
        lastActiveAt: sql<Date | null>`max(${taskComments.createdAt})`.mapWith(
          (v: string | Date | null) => (v ? new Date(v) : null),
        ),
      })
      .from(taskComments)
      .where(and(inArray(taskComments.createdById, ids), gte(taskComments.createdAt, since)))
      .groupBy(taskComments.createdById),
  ]);

  // Edits and comments are both "this person is around"; fold them together.
  const activity = new Map<string, WorkloadActivityRow>();
  for (const r of [...editRows, ...commentRows]) {
    const prev = activity.get(r.userId);
    const latest =
      prev?.lastActiveAt && r.lastActiveAt
        ? prev.lastActiveAt > r.lastActiveAt ? prev.lastActiveAt : r.lastActiveAt
        : (prev?.lastActiveAt ?? r.lastActiveAt);
    activity.set(r.userId, {
      userId: r.userId,
      actions: (prev?.actions ?? 0) + r.actions,
      lastActiveAt: latest,
    });
  }

  return summarizeWorkload({
    candidates,
    taskRows,
    activityRows: [...activity.values()],
    currentProjectId: input.currentProjectId,
    visibleTitleById: input.visibleTitleById,
  });
}
