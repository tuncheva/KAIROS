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
 *   restart, an overlapping tick) does not produce two briefs.
 * - **Bounded concurrency.** These are model calls; a hundred at once would be a
 *   self-inflicted rate limit.
 */

import "server-only";

import { and, eq, isNull, lte, or } from "drizzle-orm";

import { db } from "~/server/db";
import { aiSchedules, notifications } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
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
import { loadSystemUser, systemContextFor } from "./systemContext";

const log = createLogger("llm.scheduled");

export type ScheduleKind = "daily_brief" | "risk_radar";

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
 * "Due" means enabled, at or past the user's chosen hour, and not already run
 * today. The hour comparison is UTC — a deliberate simplification, and the one
 * thing in this module that should grow a real timezone column before this ships
 * to users outside a single region.
 */
async function dueSchedules(nowUtcHour: number, startOfDay: Date) {
  return db
    .select({
      id: aiSchedules.id,
      userId: aiSchedules.userId,
      kind: aiSchedules.kind,
    })
    .from(aiSchedules)
    .where(
      and(
        eq(aiSchedules.enabled, true),
        lte(aiSchedules.hourUtc, nowUtcHour),
        or(
          isNull(aiSchedules.lastRunAt),
          lte(aiSchedules.lastRunAt, startOfDay),
        ),
      ),
    )
    .limit(500);
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
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const due = await dueSchedules(now.getUTCHours(), startOfDay);

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
    // while this one is mid-flight will not find this row due, so the user gets
    // one brief rather than two.
    const claimed = await db
      .update(aiSchedules)
      .set({ lastRunAt: now, updatedAt: now, lastError: null })
      .where(
        and(
          eq(aiSchedules.id, schedule.id),
          or(
            isNull(aiSchedules.lastRunAt),
            lte(aiSchedules.lastRunAt, startOfDay),
          ),
        ),
      )
      .returning({ id: aiSchedules.id });

    if (!claimed.length) {
      report.skippedAlreadyRan += 1;
      return;
    }

    try {
      const sent =
        schedule.kind === "daily_brief"
          ? await runDailyBrief(schedule.userId)
          : await runRiskRadar(schedule.userId);

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
