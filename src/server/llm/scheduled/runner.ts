/**
 * The scheduled-run orchestrator.
 *
 * Finds the users who are due, runs the radar and the brief for each, and turns
 * the result into notifications. Called by the internal endpoint the ws-server
 * scheduler pokes; it does not know or care what is driving the clock.
 *
 * Design constraints, all of them consequences of "this runs while nobody is
 * watching":
 *
 * - **Opt-in only.** A user with no `ai_schedules` row gets nothing. Deploying
 *   this feature must not start messaging people who never asked for it.
 * - **One user's failure is one user's failure.** Every run is isolated; the
 *   error is recorded on that user's schedule row and the loop continues. A batch
 *   that aborts on the first bad row means the alphabetically-later half of the
 *   userbase silently never gets a brief.
 * - **The clock is idempotent-ish.** `lastRunAt` is written before the work, and
 *   a user who already ran today is skipped, so a scheduler that fires twice (a
 *   restart, an overlapping tick) does not produce two briefs. "Today" means the
 *   user's day, not UTC's.
 * - **Bounded concurrency.** These are model calls; a hundred at once would be a
 *   self-inflicted rate limit.
 */

import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "~/server/db";
import { aiSchedules, notifications, users } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import { isScheduleDue } from "./due";
import { consumeSystemRateLimit } from "~/server/security/rateLimit";
import type { SupportedLocale } from "~/server/llm/context/a1ContextBuilder";

import {
  briefIsEmpty,
  collectBriefFacts,
  fallbackBrief,
  writeBrief,
} from "./dailyBrief";
import {
  detectFindings,
  persistFindings,
  resolveStaleFindings,
} from "./riskRadar";
import {
  collectRetroFacts,
  fallbackRetro,
  retroIsEmpty,
  writeRetro,
} from "./weeklyRetro";
import { loadSystemUser, systemContextFor } from "./systemContext";

const log = createLogger("llm.scheduled");

export type ScheduleKind = "daily_brief" | "risk_radar" | "weekly_retro";

/** How many users are processed at once. */
const CONCURRENCY = 4;

export interface RunReport {
  considered: number;
  ran: number;
  skippedRateLimited: number;
  skippedAlreadyRan: number;
  failed: number;
  notificationsSent: number;
}

/**
 * Schedules that are due right now.
 *
 * "Due" means enabled, at or past the user's chosen hour *in the user's own
 * zone*, and not already run on the user's current day.
 *
 * Both conditions used to be evaluated in SQL against UTC, which is what made a
 * 07:00 brief arrive at 09:00 in Bulgaria and shift by an hour twice a year. They
 * cannot stay in SQL: the comparison now depends on a per-row zone, and the DST
 * arithmetic belongs to the IANA database rather than to a column of integers.
 *
 * So the query narrows to "enabled", and the two real predicates are applied in
 * JS. That is affordable because the result is capped at 500 rows and the sweep
 * runs hourly; the formatter cache in `~/lib/timezone` means each distinct zone
 * is constructed once. If the userbase ever makes this the wrong trade, the fix
 * is a `next_run_at` timestamp computed on write — not a return to UTC hours.
 */
async function dueSchedules(now: Date) {
  const rows = await db
    .select({
      id: aiSchedules.id,
      userId: aiSchedules.userId,
      kind: aiSchedules.kind,
      hourLocal: aiSchedules.hourLocal,
      dayOfWeek: aiSchedules.dayOfWeek,
      lastRunAt: aiSchedules.lastRunAt,
      timeZone: users.timezone,
    })
    .from(aiSchedules)
    .innerJoin(users, eq(aiSchedules.userId, users.id))
    .where(eq(aiSchedules.enabled, true))
    .limit(500);

  return rows.filter((row) => isScheduleDue(row, now));
}

async function notify(input: {
  userId: string;
  title: string;
  message: string;
  link?: string | null;
}): Promise<void> {
  await db.insert(notifications).values({
    userId: input.userId,
    type: "system",
    title: input.title,
    message: input.message,
    link: input.link ?? "/chat/ai",
  });
}

/**
 * Run one user's daily brief.
 *
 * The radar always runs, even when the model budget is spent: detection is free,
 * and findings are worth recording whether or not there is a sentence to wrap
 * around them today.
 */
async function runDailyBrief(userId: string): Promise<number> {
  const user = await loadSystemUser(userId);
  if (!user) return 0;

  const ctx = systemContextFor(user);

  const findings = await detectFindings(ctx, userId);
  const fresh = await persistFindings(ctx, userId, findings);
  await resolveStaleFindings(
    ctx,
    userId,
    findings.map((f) => f.fingerprint),
  );

  const facts = await collectBriefFacts(ctx, userId, findings);

  // Nothing to say. Staying quiet is a feature: an assistant that sends "all
  // clear" every morning is one people stop reading, and then they stop reading
  // the mornings that matter too.
  if (briefIsEmpty(facts, findings)) {
    log.debug("nothing to brief", { userId });
    return 0;
  }

  const allowed = await consumeSystemRateLimit(userId);
  const message = allowed
    ? await writeBrief({
        facts,
        findings,
        userName: user.name,
        locale: user.language as SupportedLocale,
      })
    : // Budget spent: send the facts without the prose rather than nothing.
      fallbackBrief(facts, findings);

  await notify({
    userId,
    title: "Your daily brief",
    message,
    link: "/chat/ai",
  });

  log.info("sent daily brief", {
    userId,
    findings: findings.length,
    fresh: fresh.length,
    withModel: allowed,
  });

  return 1;
}

/** Run the radar alone — findings, no brief. */
async function runRiskRadar(userId: string): Promise<number> {
  const user = await loadSystemUser(userId);
  if (!user) return 0;

  const ctx = systemContextFor(user);
  const findings = await detectFindings(ctx, userId);
  const fresh = await persistFindings(ctx, userId, findings);
  await resolveStaleFindings(
    ctx,
    userId,
    findings.map((f) => f.fingerprint),
  );

  // Only genuinely new findings are worth a notification, and only the ones that
  // matter — an "info" finding is something to see when you next look, not
  // something to be interrupted by.
  const notable = fresh.filter((f) => f.severity !== "info");
  if (!notable.length) return 0;

  await notify({
    userId,
    title:
      notable.length === 1
        ? notable[0]!.title
        : `${String(notable.length)} things need attention`,
    message: notable.map((f) => f.detail).join(" "),
    link: "/chat/ai",
  });

  return 1;
}

/**
 * Run one user's weekly retrospective.
 *
 * No radar pass, unlike the brief. The retrospective reports on findings that
 * were already raised during the week rather than looking for new ones — a risk
 * discovered while writing a review of the past seven days belongs in tomorrow's
 * brief, where it is actionable, not in a document about a window that has closed.
 */
async function runWeeklyRetro(userId: string): Promise<number> {
  const user = await loadSystemUser(userId);
  if (!user) return 0;

  const ctx = systemContextFor(user);
  const facts = await collectRetroFacts(ctx, userId);

  if (retroIsEmpty(facts)) {
    log.debug("nothing to review", { userId });
    return 0;
  }

  const allowed = await consumeSystemRateLimit(userId);
  const message = allowed
    ? await writeRetro({
        facts,
        userName: user.name,
        locale: user.language as SupportedLocale,
      })
    : fallbackRetro(facts);

  await notify({
    userId,
    title: "Your week in review",
    message,
    link: "/chat/ai",
  });

  log.info("sent weekly retro", {
    userId,
    completed: facts.completed,
    withModel: allowed,
  });

  return 1;
}

/**
 * What each kind of schedule actually runs.
 *
 * A map rather than a chain of conditionals. With two kinds a ternary was fine;
 * the third is the point at which "add a kind" should mean "add a row here" and
 * nothing else — and `Record<ScheduleKind, …>` makes the compiler say so if a
 * kind is ever added without a runner.
 */
const RUNNERS: Record<ScheduleKind, (userId: string) => Promise<number>> = {
  daily_brief: runDailyBrief,
  risk_radar: runRiskRadar,
  weekly_retro: runWeeklyRetro,
};

/** Process an array with a bounded number in flight. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

export async function runDueSchedules(now = new Date()): Promise<RunReport> {
  const due = await dueSchedules(now);

  const report: RunReport = {
    considered: due.length,
    ran: 0,
    skippedRateLimited: 0,
    skippedAlreadyRan: 0,
    failed: 0,
    notificationsSent: 0,
  };

  await mapLimit(due, CONCURRENCY, async (schedule) => {
    // Claim the slot before doing the work. A second scheduler tick that starts
    // while this one is mid-flight must not also run it.
    //
    // This is a compare-and-swap on `lastRunAt` rather than a re-test of the
    // due-ness predicate. It has to be: due-ness now depends on the user's zone
    // and is decided in JS, so it cannot be restated as a SQL `where` clause.
    // Matching the exact value this sweep read is strictly stronger anyway — the
    // update touches nothing if anyone else has advanced the row since, whatever
    // their reason, and does not depend on both sites agreeing about when the
    // day began.
    const claimed = await db
      .update(aiSchedules)
      .set({ lastRunAt: now, updatedAt: now, lastError: null })
      .where(
        and(
          eq(aiSchedules.id, schedule.id),
          schedule.lastRunAt === null
            ? isNull(aiSchedules.lastRunAt)
            : eq(aiSchedules.lastRunAt, schedule.lastRunAt),
        ),
      )
      .returning({ id: aiSchedules.id });

    if (!claimed.length) {
      report.skippedAlreadyRan += 1;
      return;
    }

    try {
      // A row whose kind predates this deploy, or postdates it, is skipped
      // rather than defaulted. `kind` is free text by design, so an unknown value
      // is possible, and silently running the radar for it would be worse than
      // doing nothing.
      const run = RUNNERS[schedule.kind as ScheduleKind];
      if (!run) {
        log.warn("unknown schedule kind, skipping", {
          userId: schedule.userId,
          kind: schedule.kind,
        });
        return;
      }

      const sent = await run(schedule.userId);

      report.ran += 1;
      report.notificationsSent += sent;
    } catch (err) {
      report.failed += 1;
      log.error("scheduled run failed", {
        userId: schedule.userId,
        kind: schedule.kind,
        err,
      });

      // Recorded on the row so a run that has been failing all week is visible
      // in the product rather than only in a log nobody tails.
      await db
        .update(aiSchedules)
        .set({
          lastError: err instanceof Error ? err.message.slice(0, 500) : "unknown",
          updatedAt: new Date(),
        })
        .where(eq(aiSchedules.id, schedule.id));
    }
  });

  log.info("scheduled sweep complete", { ...report });
  return report;
}

/** Run one user's brief on demand — used by "preview my brief" in settings. */
export async function runBriefNow(userId: string): Promise<number> {
  return runDailyBrief(userId);
}
