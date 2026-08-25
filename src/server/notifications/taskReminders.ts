/**
 * The sweep behind "Task due reminders".
 *
 * That switch has been on the settings screen for a long time, described as "get
 * notified when tasks are due". Nothing in the codebase read `tasks.due_date` to
 * send anything. The nearest thing was the AI risk radar's deadline detector,
 * which grades upcoming deadlines into a *brief* — a different feature, delivered
 * only to users who created a schedule, and governed by that schedule rather than
 * by this preference. So the switch governed nothing at all.
 *
 * Shares the scheduler tick with the event reminder sweep, for the same reasons.
 */

import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { projects, tasks } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { notify } from "~/server/notifications/dispatch";

const log = createLogger("notifications.taskReminders");

/**
 * How far ahead a task has to be to earn a reminder.
 *
 * A day. Long enough to act on, short enough that the reminder is about today's
 * work rather than a vague someday — and it deliberately does not overlap the
 * risk radar's week-long horizon, which exists to prompt planning rather than to
 * say "this is due now".
 */
const LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * How far past the due date a reminder is still worth sending.
 *
 * A task that slipped yesterday is still actionable, so unlike an event — which
 * is simply over once it starts — the window extends past the deadline. Beyond
 * this the task is late enough that a "due soon" notice would be wrong.
 */
const OVERDUE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Bounded so one sweep cannot become an unbounded write burst. */
const MAX_PER_SWEEP = 500;

export interface TaskReminderReport {
  considered: number;
  sent: number;
  /** Due, marked handled, but not delivered — the recipient has these switched off. */
  skipped: number;
}

/**
 * Remind assignees about work that is about to be, or has just become, late.
 *
 * Only the assignee is notified. An unassigned task has nobody whose problem it
 * is yet, and notifying the whole project about every deadline is the storm the
 * risk radar was explicitly designed to avoid.
 */
export async function sendDueTaskReminders(now = new Date()): Promise<TaskReminderReport> {
  const dueRows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assignedToId: tasks.assignedToId,
      projectId: tasks.projectId,
      projectTitle: projects.title,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        isNull(tasks.dueReminderSentAt),
        sql`${tasks.assignedToId} IS NOT NULL`,
        // Finished work needs no reminder. `blocked` still gets one: a blocked
        // task hitting its deadline is precisely what someone needs to hear.
        sql`${tasks.status} <> 'completed'`,
        lte(tasks.dueDate, new Date(now.getTime() + LEAD_MS)),
        gt(tasks.dueDate, new Date(now.getTime() - OVERDUE_GRACE_MS)),
      ),
    )
    .orderBy(asc(tasks.dueDate))
    .limit(MAX_PER_SWEEP);

  const report: TaskReminderReport = {
    considered: dueRows.length,
    sent: 0,
    skipped: 0,
  };

  for (const row of dueRows) {
    // Narrowed by the query above; the guard keeps the types honest.
    if (!row.assignedToId || !row.dueDate) continue;

    const overdue = row.dueDate.getTime() < now.getTime();

    const result = await notify({
      db,
      userId: row.assignedToId,
      category: "taskDueReminder",
      type: "task",
      title: overdue ? "Task now overdue" : "Task due soon",
      message: overdue
        ? `"${row.title}" in ${row.projectTitle} passed its due date.`
        : `"${row.title}" in ${row.projectTitle} is due ${formatDue(row.dueDate, now)}.`,
      link: `/projects?projectId=${String(row.projectId)}`,
    });

    // Stamped whether or not it was delivered, so a user who re-enables the
    // preference does not receive a backlog of stale deadlines.
    await db
      .update(tasks)
      .set({ dueReminderSentAt: now })
      .where(eq(tasks.id, row.taskId));

    if (result.delivered) report.sent += 1;
    else report.skipped += 1;
  }

  if (report.considered > 0) {
    log.info("task due reminder sweep", { ...report });
  }

  return report;
}

/**
 * Clear the stamp on tasks whose due date moved into the future.
 *
 * Without this, rescheduling a task it had already reminded about means it never
 * reminds again — the reminder silently belongs to the old date. Run as part of
 * the sweep rather than on the edit path so it also repairs rows changed by the
 * agent tools and any future writer.
 */
export async function rearmMovedTaskReminders(now = new Date()): Promise<number> {
  const rearmed = await db
    .update(tasks)
    .set({ dueReminderSentAt: null })
    .where(
      and(
        sql`${tasks.dueReminderSentAt} IS NOT NULL`,
        or(
          isNull(tasks.dueDate),
          gt(tasks.dueDate, new Date(now.getTime() + LEAD_MS)),
        ),
      ),
    )
    .returning({ id: tasks.id });

  return rearmed.length;
}

/** "in 4 hours", "tomorrow" — enough to convey urgency without a full date. */
function formatDue(dueDate: Date, now: Date): string {
  const minutes = Math.round((dueDate.getTime() - now.getTime()) / 60_000);
  if (minutes < 60) return `in ${String(Math.max(minutes, 1))} minutes`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${String(hours)} hour${hours === 1 ? "" : "s"}`;

  return "tomorrow";
}
