/**
 * B-2 / B-3 — the Risk Radar.
 *
 * A scheduled pass over the user's active projects that produces *findings*: an
 * overdue cluster, work nobody owns, a project that has not moved in a fortnight.
 *
 * Two decisions shape the whole module:
 *
 * **The detection is deterministic, not a model call.** "Six tasks are overdue"
 * is a `COUNT`, and asking a language model to do arithmetic over four hundred
 * rows is slower, costlier and less correct than asking Postgres. The model's
 * job — in `dailyBrief.ts` — is to turn findings into a sentence worth reading,
 * which is the part it is actually good at. It also means the radar runs for a
 * user whose AI budget is exhausted, and that a finding is reproducible: the same
 * data yields the same finding, so "why am I being told this?" has an answer.
 *
 * **Findings are stored and fingerprinted.** Firing straight into notifications
 * would re-report the same overdue task every morning until it was fixed, which
 * is how a helpful feature becomes one people mute in a week. A fingerprint makes
 * a finding idempotent, and the stored row is also what makes dismissal rate
 * measurable — the metric that decides whether proactive AI is earning its place
 * at all.
 */

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiFindings, projects, tasks } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { loadVisibleScope, visibleProjectsWhere } from "~/server/llm/tools/a1/scope";

import { deadlineFindings } from "./deadlines";

const log = createLogger("llm.riskRadar");

export type FindingSeverity = "info" | "warning" | "critical";

export type FindingKind =
  | "overdue_cluster"
  | "unassigned_work"
  | "stalled_project"
  | "missing_due_dates"
  | "blocked_tasks"
  | "event_needs_detail"
  | "deadline_approaching";

export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  projectId: number | null;
  title: string;
  detail: string;
  /** Stable identity, so the same risk is raised once and not once a day. */
  fingerprint: string;
  /** Task ids the finding is about, for the pre-drafted fix (B-3). */
  taskIds: number[];
}

/** How stale a project must be before "stalled" is worth saying. */
const STALL_WINDOW_DAYS = 14;
/** Below this, "3 tasks are overdue" is noise the user can already see. */
const OVERDUE_CLUSTER_MIN = 3;
const UNASSIGNED_MIN = 3;

/**
 * Bucket a count so the fingerprint is stable while the situation is.
 *
 * Fingerprinting the raw count would re-raise "overdue work" every time the
 * number ticked from 6 to 7 — technically a new finding, practically the same
 * one the user already dismissed. Bucketing means the finding returns only when
 * the situation has changed in a way worth a second interruption.
 */
function bucket(count: number): string {
  if (count < 5) return "few";
  if (count < 10) return "several";
  if (count < 25) return "many";
  return "lots";
}

export async function detectFindings(
  ctx: TRPCContext,
  userId: string,
): Promise<Finding[]> {
  const scope = await loadVisibleScope(ctx, userId);

  const visible = await ctx.db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(visibleProjectsWhere(scope), eq(projects.status, "active")));

  if (!visible.length) return [];

  const projectIds = visible.map((p) => p.id);
  const titleById = new Map(visible.map((p) => [p.id, p.title]));

  const now = new Date();
  const stallCutoff = new Date(
    now.getTime() - STALL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows = await ctx.db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      assignedToId: tasks.assignedToId,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(inArray(tasks.projectId, projectIds));

  const findings: Finding[] = [];

  for (const project of visible) {
    const mine = rows.filter((r) => r.projectId === project.id);
    if (!mine.length) continue;

    const open = mine.filter((t) => t.status !== "completed");
    const name = titleById.get(project.id) ?? "this project";

    // ---- overdue cluster
    const overdue = open.filter((t) => t.dueDate && t.dueDate < now);
    if (overdue.length >= OVERDUE_CLUSTER_MIN) {
      findings.push({
        kind: "overdue_cluster",
        severity: overdue.length >= 10 ? "critical" : "warning",
        projectId: project.id,
        title: `${String(overdue.length)} overdue tasks in ${name}`,
        detail: `${overdue.length} tasks in ${name} are past their due date. The oldest is “${overdue.sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))[0]?.title ?? ""}”.`,
        fingerprint: `overdue:${String(project.id)}:${bucket(overdue.length)}`,
        taskIds: overdue.map((t) => t.id),
      });
    }

    // ---- work nobody owns
    const unassigned = open.filter((t) => !t.assignedToId);
    if (unassigned.length >= UNASSIGNED_MIN) {
      findings.push({
        kind: "unassigned_work",
        severity: "warning",
        projectId: project.id,
        title: `${String(unassigned.length)} unassigned tasks in ${name}`,
        detail: `${unassigned.length} open tasks in ${name} have no assignee, so nobody is going to pick them up by default.`,
        fingerprint: `unassigned:${String(project.id)}:${bucket(unassigned.length)}`,
        taskIds: unassigned.map((t) => t.id),
      });
    }

    // ---- stalled
    const recentlyCompleted = mine.filter(
      (t) => t.completedAt && t.completedAt >= stallCutoff,
    );
    if (open.length > 0 && recentlyCompleted.length === 0) {
      findings.push({
        kind: "stalled_project",
        severity: "warning",
        projectId: project.id,
        title: `${name} hasn't moved in ${String(STALL_WINDOW_DAYS)} days`,
        detail: `Nothing has been completed in ${name} for ${STALL_WINDOW_DAYS} days, and ${open.length} tasks are still open.`,
        // No count in the fingerprint: a project either is stalled or it is not,
        // and re-raising it as the open count drifts would be nagging.
        fingerprint: `stalled:${String(project.id)}`,
        taskIds: [],
      });
    }

    // ---- blocked
    const blocked = open.filter((t) => t.status === "blocked");
    if (blocked.length > 0) {
      findings.push({
        kind: "blocked_tasks",
        severity: blocked.length >= 3 ? "warning" : "info",
        projectId: project.id,
        title: `${String(blocked.length)} blocked task(s) in ${name}`,
        detail: `${blocked.length} task(s) in ${name} are marked blocked. Blocked work does not unblock itself.`,
        fingerprint: `blocked:${String(project.id)}:${bucket(blocked.length)}`,
        taskIds: blocked.map((t) => t.id),
      });
    }

    // ---- no due dates
    const undated = open.filter((t) => !t.dueDate);
    if (undated.length >= 5 && undated.length === open.length) {
      findings.push({
        kind: "missing_due_dates",
        severity: "info",
        projectId: project.id,
        title: `No due dates anywhere in ${name}`,
        detail: `All ${open.length} open tasks in ${name} are undated, so nothing can be reported as late or on time.`,
        fingerprint: `undated:${String(project.id)}`,
        taskIds: undated.map((t) => t.id),
      });
    }
  }

  // Deadline watch runs once across every visible task rather than inside the
  // per-project loop: it is about the caller's own week, and a person's deadlines
  // do not partition by project. It reuses `rows`, so it costs no extra query.
  const deadlines = deadlineFindings({
    tasks: rows,
    projectNames: titleById,
    userId,
    now,
  });
  findings.push(...deadlines.findings);

  // Logged rather than swallowed. A cap that silently truncates reads as
  // "everything was covered" when it was not, and the number is the signal that
  // the cap needs revisiting.
  if (deadlines.omitted) {
    log.info("deadline findings capped", {
      userId,
      shown: deadlines.findings.length,
      omitted: deadlines.omitted,
    });
  }

  return findings;
}

/**
 * Store findings, skipping any already open under the same fingerprint.
 *
 * Returns only the newly created ones — those are what may become a notification.
 * Re-raising a finding the user has already seen (or already dismissed) is the
 * failure mode that gets a feature switched off.
 */
export async function persistFindings(
  ctx: TRPCContext,
  userId: string,
  findings: Finding[],
): Promise<Finding[]> {
  if (!findings.length) return [];

  const existing = await ctx.db
    .select({ fingerprint: aiFindings.fingerprint })
    .from(aiFindings)
    .where(
      and(
        eq(aiFindings.userId, userId),
        inArray(
          aiFindings.fingerprint,
          findings.map((f) => f.fingerprint),
        ),
      ),
    );

  const seen = new Set(existing.map((e) => e.fingerprint));
  const fresh = findings.filter((f) => !seen.has(f.fingerprint));
  if (!fresh.length) return [];

  await ctx.db.insert(aiFindings).values(
    fresh.map((f) => ({
      userId,
      projectId: f.projectId,
      fingerprint: f.fingerprint,
      kind: f.kind,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      status: "open",
    })),
  );

  log.debug("recorded new findings", { userId, count: fresh.length });
  return fresh;
}

/**
 * Close findings whose underlying problem is gone.
 *
 * Without this a fixed problem stays on the list forever, and the list stops
 * being a to-do and becomes a graveyard. Runs on every pass: anything open that
 * this pass did not re-detect has been resolved by definition, because detection
 * is deterministic over current data.
 */
export async function resolveStaleFindings(
  ctx: TRPCContext,
  userId: string,
  currentFingerprints: string[],
): Promise<number> {
  const open = await ctx.db
    .select({ id: aiFindings.id, fingerprint: aiFindings.fingerprint })
    .from(aiFindings)
    .where(and(eq(aiFindings.userId, userId), eq(aiFindings.status, "open")));

  const current = new Set(currentFingerprints);
  const goneIds = open.filter((f) => !current.has(f.fingerprint)).map((f) => f.id);
  if (!goneIds.length) return 0;

  await ctx.db
    .update(aiFindings)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(inArray(aiFindings.id, goneIds));

  return goneIds.length;
}

/**
 * B-3 — the one-click fix a finding carries.
 *
 * Returned as a *description* of the fix rather than as an applied change: the
 * user still confirms. What this buys is that the confirmation card is already
 * filled in, so acting on a nudge costs one click instead of retyping the
 * problem back to the assistant that just reported it.
 */
export interface SuggestedFix {
  /** The message to seed the agent with, in the user's language-neutral terms. */
  prompt: string;
  /** What the button should say. */
  label: string;
}

export function suggestedFixFor(finding: Finding): SuggestedFix | null {
  switch (finding.kind) {
    case "overdue_cluster":
      return {
        prompt: `Reschedule the overdue tasks in project ${String(finding.projectId)} to realistic new due dates, keeping their priority order.`,
        label: "Reschedule them",
      };
    case "unassigned_work":
      return {
        prompt: `Suggest an assignee for each unassigned task in project ${String(finding.projectId)}, balancing the load across the team.`,
        label: "Suggest assignees",
      };
    case "missing_due_dates":
      return {
        prompt: `Propose due dates for the undated open tasks in project ${String(finding.projectId)}, based on their priority and dependencies.`,
        label: "Propose due dates",
      };
    case "blocked_tasks":
      return {
        prompt: `Review the blocked tasks in project ${String(finding.projectId)} and suggest what would unblock each one.`,
        label: "Review blockers",
      };
    case "deadline_approaching":
      return {
        // Deliberately not "reschedule it". The finding fires while there is
        // still time to act, so the useful first move is working out what the
        // task actually needs — moving the date is what you do after deciding you
        // cannot make it, and offering that as the one-click default teaches the
        // user that the nudge means "give up".
        prompt: `Task ${String(finding.taskIds[0] ?? 0)} is due very soon and not finished. Tell me what is left on it, and whether to split it, hand it over, or move the date.`,
        label: "What does it need?",
      };
    // A stalled project needs a conversation, not a bulk edit. Offering a
    // one-click "fix" for it would be theatre.
    case "stalled_project":
    case "event_needs_detail":
      return null;
  }
}

/** Findings currently open for a user, newest first. */
export async function listOpenFindings(ctx: TRPCContext, userId: string) {
  return ctx.db
    .select()
    .from(aiFindings)
    .where(and(eq(aiFindings.userId, userId), eq(aiFindings.status, "open")))
    .orderBy(sql`
      CASE ${aiFindings.severity}
        WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2
      END
    `, aiFindings.createdAt)
    .limit(25);
}

export async function dismissFinding(
  ctx: TRPCContext,
  userId: string,
  findingId: number,
): Promise<void> {
  await ctx.db
    .update(aiFindings)
    .set({ status: "dismissed", dismissedAt: new Date() })
    .where(and(eq(aiFindings.id, findingId), eq(aiFindings.userId, userId)));
}

/**
 * The metric that decides whether any of this was worth building.
 *
 * An assistant that speaks unprompted is only tolerable while what it says is
 * worth reading. If dismissal rate climbs, the radar is producing noise and the
 * thresholds above are wrong — that is a product signal, not a bug report, and
 * it needs to be visible.
 */
export async function findingStats(ctx: TRPCContext, userId: string) {
  const [row] = await ctx.db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      dismissed: sql<number>`count(*) FILTER (WHERE ${aiFindings.status} = 'dismissed')`.mapWith(Number),
      resolved: sql<number>`count(*) FILTER (WHERE ${aiFindings.status} = 'resolved')`.mapWith(Number),
      open: sql<number>`count(*) FILTER (WHERE ${aiFindings.status} = 'open')`.mapWith(Number),
    })
    .from(aiFindings)
    .where(eq(aiFindings.userId, userId));

  const total = row?.total ?? 0;
  return {
    total,
    open: row?.open ?? 0,
    dismissed: row?.dismissed ?? 0,
    resolved: row?.resolved ?? 0,
    dismissalRate: total === 0 ? 0 : Math.round(((row?.dismissed ?? 0) / total) * 100),
  };
}
