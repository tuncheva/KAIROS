/**
 * Deadline watch — the one detector that looks forward.
 *
 * Every other finding in `riskRadar.ts` is a per-project aggregate about
 * something that has already gone wrong: six tasks overdue, nothing completed in
 * a fortnight. This one is about a specific task that is *about to* go wrong, and
 * that difference forces three departures from the pattern next door.
 *
 * **It grades by state, not by date.** A task due in two days that nobody has
 * started is a different message from one due tomorrow that is nearly finished.
 * A pure date threshold would rank those identically, which is how a deadline
 * reminder becomes a thing people learn to ignore.
 *
 * **It is per-task, so it has to be capped.** The aggregate detectors are
 * naturally bounded — one finding per project per kind. "Every task due this
 * week" is unbounded, and a user with twenty deadlines would get twenty findings,
 * which is the notification storm the radar was explicitly designed to avoid.
 * Only the user's *own* tasks are considered, and only the most urgent
 * {@link MAX_DEADLINE_FINDINGS} survive; the rest are reported as a count by the
 * caller rather than dropped silently.
 *
 * **The band is in the fingerprint.** This is the subtle one. A finding is
 * deduped on its fingerprint, so `deadline:{taskId}` alone would raise a task
 * once — at seven days out — and then never again as it crossed into "due
 * tomorrow, still untouched". Encoding the band means escalation reads as a new
 * finding, which is the entire point of the feature. Get this wrong and it looks
 * like it works: findings appear, nothing ever escalates.
 *
 * Pure and free of database access, so the grading rules can be tested directly.
 */

import "server-only";

import type { Finding, FindingSeverity } from "./riskRadar";

/**
 * How far ahead to look.
 *
 * A week. Far enough that a task with real work left in it can still be saved,
 * near enough that the warning is about this week rather than a vague someday.
 */
export const DEADLINE_HORIZON_DAYS = 7;

/**
 * The most deadline findings one sweep will raise.
 *
 * Chosen to be smaller than a person's tolerance for interruption rather than
 * larger than their backlog. The overflow is counted, not hidden — see
 * {@link DeadlineResult}.
 */
export const MAX_DEADLINE_FINDINGS = 5;

/**
 * The urgency bands, coarsest part of the fingerprint.
 *
 * Named rather than numeric so the fingerprint is readable in the database and so
 * a change of thresholds does not silently re-raise every finding: `imminent`
 * stays `imminent` even if the day count behind it is retuned.
 */
export type DeadlineBand = "imminent" | "soon" | "upcoming";

/** The task fields the grading needs. Deliberately narrow. */
export interface DeadlineTask {
  id: number;
  title: string;
  projectId: number;
  status: string;
  dueDate: Date | null;
  assignedToId: string | null;
}

export interface DeadlineResult {
  findings: Finding[];
  /** How many qualified but were cut by {@link MAX_DEADLINE_FINDINGS}. */
  omitted: number;
}

/** Whole days from `now` until `due`, rounded down. Negative when overdue. */
function daysUntil(due: Date, now: Date): number {
  return Math.floor((due.getTime() - now.getTime()) / 86_400_000);
}

function bandFor(days: number): DeadlineBand {
  if (days <= 1) return "imminent";
  if (days <= 3) return "soon";
  return "upcoming";
}

/**
 * How loudly to say it.
 *
 * The matrix that makes this detector worth having. `pending` means nobody has
 * started, so the full remaining work is still ahead; `in_progress` means someone
 * is on it and a deadline is a nudge rather than an alarm. `blocked` is the worst
 * case at any distance — a blocked task does not unblock itself, and a deadline
 * approaching one is a problem that needs a person, not a reminder.
 */
export function gradeDeadline(
  status: string,
  band: DeadlineBand,
): FindingSeverity | null {
  if (status === "completed") return null;

  if (status === "blocked") {
    return band === "upcoming" ? "warning" : "critical";
  }

  if (status === "pending") {
    if (band === "imminent") return "critical";
    if (band === "soon") return "warning";
    return "info";
  }

  // in_progress, and anything else a future status enum adds. Treated as the
  // gentler case on purpose: an unknown status is more likely to mean "someone is
  // handling this" than "nobody is", and over-alarming is what gets a proactive
  // feature muted.
  if (band === "imminent") return "warning";
  return "info";
}

/** Rank for the cap: critical first, then the nearest deadline. */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function detailFor(
  title: string,
  projectName: string,
  days: number,
  status: string,
): string {
  const when =
    days <= 0
      ? "due today"
      : days === 1
        ? "due tomorrow"
        : `due in ${String(days)} days`;

  const state =
    status === "blocked"
      ? "and it is blocked"
      : status === "pending"
        ? "and nothing has been done on it yet"
        : "and it is in progress";

  return `“${title}” in ${projectName} is ${when}, ${state}.`;
}

/**
 * Findings for the caller's own deadlines inside the horizon.
 *
 * Overdue tasks are excluded: the overdue cluster detector already owns that
 * ground, and raising both would report the same task twice under two headings.
 * This is about the window where acting still helps.
 *
 * Only `warning` and `critical` are emitted. An `info` deadline — something due
 * on Friday that is already in progress — is a normal working week, and the
 * runner would not notify on it anyway; recording it would only add rows that
 * inflate the retrospective's "risks raised" count with non-risks.
 */
export function deadlineFindings(input: {
  tasks: DeadlineTask[];
  projectNames: Map<number, string>;
  userId: string;
  now: Date;
}): DeadlineResult {
  const { tasks, projectNames, userId, now } = input;

  const graded: Array<{ finding: Finding; rank: number; days: number }> = [];

  for (const task of tasks) {
    if (!task.dueDate) continue;
    if (task.assignedToId !== userId) continue;

    const days = daysUntil(task.dueDate, now);
    // Past its date belongs to `overdue_cluster`; beyond the horizon is not yet
    // news.
    if (days < 0 || days > DEADLINE_HORIZON_DAYS) continue;

    const band = bandFor(days);
    const severity = gradeDeadline(task.status, band);
    if (severity === null || severity === "info") continue;

    const projectName = projectNames.get(task.projectId) ?? "this project";

    graded.push({
      rank: SEVERITY_RANK[severity],
      days,
      finding: {
        kind: "deadline_approaching",
        severity,
        projectId: task.projectId,
        title:
          days <= 0
            ? `“${task.title}” is due today`
            : days === 1
              ? `“${task.title}” is due tomorrow`
              : `“${task.title}” is due in ${String(days)} days`,
        detail: detailFor(task.title, projectName, days, task.status),
        // Band, not day count. `deadline:41:soon` becomes `deadline:41:imminent`
        // when it escalates, which is a new fingerprint and therefore a new
        // finding — while a task sitting still inside one band stays quiet.
        fingerprint: `deadline:${String(task.id)}:${band}`,
        taskIds: [task.id],
      },
    });
  }

  graded.sort((a, b) => a.rank - b.rank || a.days - b.days);

  return {
    findings: graded.slice(0, MAX_DEADLINE_FINDINGS).map((g) => g.finding),
    omitted: Math.max(0, graded.length - MAX_DEADLINE_FINDINGS),
  };
}
