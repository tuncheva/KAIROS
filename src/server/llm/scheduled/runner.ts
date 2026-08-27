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

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "~/server/db";
import { notify } from "~/server/notifications/dispatch";
import {
  aiCustomSchedules,
  aiSchedules,
  externalEvents,
  users,
} from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import { entitlementsFor } from "~/server/billing/entitlements";
import { sendBriefEmail } from "~/server/email/email";

import { runCustomSchedule } from "./customSchedules";
import {
  collectPrepFacts,
  fallbackPrep,
  prepIsEmpty,
  writePrep,
} from "./meetingPrep";
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

export type ScheduleKind =
  | "daily_brief"
  | "risk_radar"
  | "weekly_retro"
  | "meeting_prep";

/**
 * Kinds whose cadence is an hour of the day.
 *
 * `meeting_prep` is not one of them: it is due whenever a meeting is close, which
 * is a question about the calendar rather than about the clock. It runs on every
 * tick through its own pass, and is excluded from the hour-gated sweep so
 * `isScheduleDue` is not asked a question it cannot answer.
 */
const HOUR_GATED_KINDS = [
  "daily_brief",
  "risk_radar",
  "weekly_retro",
] as const satisfies readonly ScheduleKind[];

/** The kinds the hour-gated dispatch below is responsible for. */
type HourGatedKind = (typeof HOUR_GATED_KINDS)[number];

/** How many users are processed at once. */
const CONCURRENCY = 4;

export interface CustomReport {
  considered: number;
  ran: number;
  skippedOverCap: number;
  failed: number;
  notificationsSent: number;
}

export interface RunReport {
  considered: number;
  ran: number;
  skippedRateLimited: number;
  skippedAlreadyRan: number;
  failed: number;
  notificationsSent: number;
  /** Present once the custom-schedule pass has run. */
  custom?: CustomReport;
  /** Present once the meeting-prep pass has run. */
  meetingPrep?: CustomReport;
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
      channel: aiSchedules.channel,
      channelFailures: aiSchedules.channelFailures,
      lastRunAt: aiSchedules.lastRunAt,
      timeZone: users.timezone,
    })
    .from(aiSchedules)
    .innerJoin(users, eq(aiSchedules.userId, users.id))
    .where(
      and(
        eq(aiSchedules.enabled, true),
        inArray(aiSchedules.kind, [...HOUR_GATED_KINDS]),
      ),
    )
    .limit(500);

  return rows.filter((row) => isScheduleDue(row, now));
}

/**
 * Send one scheduled-run notification.
 *
 * A thin wrapper over `notifications/dispatch` rather than a direct call at each
 * site, so the category and the default link are stated once. Named
 * `notifyUser` because `notify` is the imported dispatcher — a local function of
 * the same name shadows it and recurses.
 */
async function notifyUser(input: {
  userId: string;
  title: string;
  message: string;
  link?: string | null;
}): Promise<void> {
  /* Category `requested`: the user created this schedule themselves, so it is
     not gated by a category toggle — only by the master in-app switch. A per-item
     opt-in is a stronger statement of intent than any category default. To stop
     these, delete or disable the schedule. */
  await notify({
    db,
    userId: input.userId,
    category: "requested",
    type: "system",
    title: input.title,
    message: input.message,
    link: input.link ?? "/chat/ai",
  });
}

/** Consecutive email failures before the channel is turned off. */
const MAX_CHANNEL_FAILURES = 3;

/** What one run needs to know about the row that asked for it. */
interface RunTarget {
  userId: string;
  scheduleId: number | null;
  channel: string;
  channelFailures: number;
}

/**
 * Put the result where the user asked for it.
 *
 * The reason this is not just `notify()` any more: a proactive feature whose
 * output waits in a tab for someone to come and find it is the weakest possible
 * version of proactive. Email is where the morning already happens.
 *
 * Three behaviours are worth stating, because each one is a decision rather than
 * an implementation detail:
 *
 * - **A failed email still becomes an in-app notification.** If email was the
 *   only channel and it bounced, silently dropping the brief would be the worst
 *   outcome — the work was done, the budget was spent, and the user hears
 *   nothing. The fallback means a delivery problem costs the *channel*, never the
 *   message.
 * - **Failures are counted, and three in a row disables the channel.** A mistyped
 *   address otherwise generates a bounce every morning forever, visible only to
 *   whoever reads the logs. The user is told in-app when this happens, because a
 *   setting that turned itself off without saying so is indistinguishable from a
 *   bug.
 * - **A success resets the count.** Three failures spread over six months is
 *   evidence of nothing; three consecutive is evidence the address is dead.
 * - **The account-level email preference outranks the per-schedule channel.**
 *   `emailNotifications` was read by nothing, so a user who switched email off in
 *   Settings kept receiving briefs by email. It is checked here rather than at
 *   each caller because every delivery path funnels through this function.
 */
async function deliver(
  target: RunTarget,
  input: { email: string | null; userName: string | null; title: string; message: string },
): Promise<void> {
  const channelWantsEmail = target.channel === "email" || target.channel === "both";
  const wantsApp = target.channel === "app" || target.channel === "both";

  /* Off is a *choice*, not a delivery failure. So it must not count toward the
     three-strikes counter that disables the channel, and it must not be reported
     as an error — but the brief still has to land somewhere, so in-app takes
     over exactly as it does for a bounce. */
  let emailSuppressed = false;
  if (channelWantsEmail) {
    const [prefs] = await db
      .select({ emailNotifications: users.emailNotifications })
      .from(users)
      .where(eq(users.id, target.userId))
      .limit(1);
    emailSuppressed = prefs ? !prefs.emailNotifications : true;
  }

  const wantsEmail = channelWantsEmail && !emailSuppressed;

  let emailError: string | null = null;

  if (wantsEmail) {
    if (!input.email) {
      emailError = "No email address on the account";
    } else {
      const sent = await sendBriefEmail({
        email: input.email,
        userName: input.userName ?? "there",
        heading: input.title,
        body: input.message,
      });
      if (!sent) emailError = "Email delivery failed";
    }
  }

  // In-app when asked for, and always as the fallback when email was the only
  // route and it did not work — or was switched off at the account level.
  if (wantsApp || emailError || emailSuppressed) {
    await notifyUser({
      userId: target.userId,
      title: input.title,
      message: input.message,
    });
  }

  if (!wantsEmail || target.scheduleId === null) return;

  if (emailError) {
    const failures = target.channelFailures + 1;

    if (failures >= MAX_CHANNEL_FAILURES) {
      await db
        .update(aiSchedules)
        .set({
          channel: "app",
          channelFailures: 0,
          lastError: `${emailError} ${String(failures)} times in a row — email delivery turned off`,
          updatedAt: new Date(),
        })
        .where(eq(aiSchedules.id, target.scheduleId));

      await notifyUser({
        userId: target.userId,
        title: "Email delivery turned off",
        message: `We could not deliver your brief by email ${String(failures)} times in a row, so it will arrive here instead. Check your address in Settings → AI.`,
        link: "/settings",
      });

      log.warn("email channel disabled after repeated failures", {
        userId: target.userId,
        failures,
      });
      return;
    }

    await db
      .update(aiSchedules)
      .set({ channelFailures: failures, lastError: emailError, updatedAt: new Date() })
      .where(eq(aiSchedules.id, target.scheduleId));
    return;
  }

  // Only write on a change: the common case is zero staying zero, and a sweep
  // should not issue an update per user per day to say nothing happened.
  if (target.channelFailures > 0) {
    await db
      .update(aiSchedules)
      .set({ channelFailures: 0, updatedAt: new Date() })
      .where(eq(aiSchedules.id, target.scheduleId));
  }
}

/**
 * Run one user's daily brief.
 *
 * The radar always runs, even when the model budget is spent: detection is free,
 * and findings are worth recording whether or not there is a sentence to wrap
 * around them today.
 */
async function runDailyBrief(target: RunTarget): Promise<number> {
  const { userId } = target;
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

  await deliver(target, {
    email: user.email,
    userName: user.name,
    title: "Your daily brief",
    message,
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
async function runRiskRadar(target: RunTarget): Promise<number> {
  const { userId } = target;
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

  await deliver(target, {
    email: user.email,
    userName: user.name,
    title:
      notable.length === 1
        ? notable[0]!.title
        : `${String(notable.length)} things need attention`,
    message: notable.map((f) => f.detail).join(" "),
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
async function runWeeklyRetro(target: RunTarget): Promise<number> {
  const { userId } = target;
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

  await deliver(target, {
    email: user.email,
    userName: user.name,
    title: "Your week in review",
    message,
  });

  log.info("sent weekly retro", {
    userId,
    completed: facts.completed,
    withModel: allowed,
  });

  return 1;
}

/**
 * Run meeting prep for everyone who has it on.
 *
 * Separate from the hour-gated sweep because its cadence is different in kind:
 * it fires when a meeting is close, so every tick asks "is anything within the
 * horizon that has not been covered?" rather than "has the chosen hour arrived?".
 *
 * Idempotence comes from `external_events.preppedAt`, not from `lastRunAt` — the
 * question is whether *this meeting* was covered, and a per-schedule timestamp
 * cannot answer it for a user with four meetings in an afternoon.
 */
async function runDueMeetingPreps(now: Date): Promise<CustomReport> {
  const rows = await db
    .select({
      id: aiSchedules.id,
      userId: aiSchedules.userId,
      channel: aiSchedules.channel,
      channelFailures: aiSchedules.channelFailures,
    })
    .from(aiSchedules)
    .where(
      and(
        eq(aiSchedules.enabled, true),
        eq(aiSchedules.kind, "meeting_prep"),
      ),
    )
    .limit(500);

  const report: CustomReport = {
    considered: rows.length,
    ran: 0,
    skippedOverCap: 0,
    failed: 0,
    notificationsSent: 0,
  };

  for (const row of rows) {
    try {
      const user = await loadSystemUser(row.userId);
      if (!user) continue;

      const ctx = systemContextFor(user);
      const facts = await collectPrepFacts(ctx, row.userId, { now });

      if (prepIsEmpty(facts)) continue;

      report.ran += 1;

      const allowed = await consumeSystemRateLimit(row.userId);
      const message = allowed
        ? await writePrep({
            facts,
            userName: user.name,
            locale: user.language as SupportedLocale,
          })
        : fallbackPrep(facts);

      await deliver(
        {
          userId: row.userId,
          scheduleId: row.id,
          channel: row.channel,
          channelFailures: row.channelFailures,
        },
        {
          email: user.email,
          userName: user.name,
          title:
            facts.meetings.length === 1
              ? `Before "${facts.meetings[0]!.title}"`
              : `${String(facts.meetings.length)} meetings coming up`,
          message,
        },
      );

      // Marked only after delivery. Marking first would lose the brief entirely
      // if delivery threw, and a meeting nobody was told about is worse than one
      // mentioned twice.
      await db
        .update(externalEvents)
        .set({ preppedAt: now })
        .where(
          inArray(
            externalEvents.id,
            facts.meetings.map((m) => m.id),
          ),
        );

      report.notificationsSent += 1;
    } catch (err) {
      report.failed += 1;
      log.error("meeting prep failed", { userId: row.userId, err });
    }
  }

  return report;
}

/**
 * What each kind of schedule actually runs.
 *
 * A map rather than a chain of conditionals. With two kinds a ternary was fine;
 * the third is the point at which "add a kind" should mean "add a row here" and
 * nothing else — and `Record<ScheduleKind, …>` makes the compiler say so if a
 * kind is ever added without a runner.
 */
const RUNNERS: Record<
  HourGatedKind,
  (target: RunTarget) => Promise<number>
> = {
  daily_brief: runDailyBrief,
  risk_radar: runRiskRadar,
  weekly_retro: runWeeklyRetro,
};

/**
 * Custom schedules that are due, with the caller's zone attached.
 *
 * Separate query and separate loop from the built-ins, mirroring the separate
 * table. The due-ness rule is shared — `isScheduleDue` does not care which table
 * a row came from — which is the part that actually needed to agree.
 */
async function dueCustomSchedules(now: Date) {
  const rows = await db
    .select({
      id: aiCustomSchedules.id,
      userId: aiCustomSchedules.userId,
      name: aiCustomSchedules.name,
      prompt: aiCustomSchedules.prompt,
      hourLocal: aiCustomSchedules.hourLocal,
      dayOfWeek: aiCustomSchedules.dayOfWeek,
      channel: aiCustomSchedules.channel,
      channelFailures: aiCustomSchedules.channelFailures,
      lastRunAt: aiCustomSchedules.lastRunAt,
      timeZone: users.timezone,
    })
    .from(aiCustomSchedules)
    .innerJoin(users, eq(aiCustomSchedules.userId, users.id))
    .where(eq(aiCustomSchedules.enabled, true))
    .limit(500);

  return rows.filter((row) => isScheduleDue(row, now));
}

/**
 * Run the custom schedules that are due.
 *
 * The per-user cap is applied here rather than only at insert. Enforcing it only
 * on write would let a user who downgrades keep running the schedules they
 * created while entitled to them — so the ceiling is re-read at execution, and
 * anything past it is skipped rather than deleted. Their rows survive an upgrade.
 */
async function runDueCustomSchedules(now: Date): Promise<CustomReport> {
  const due = await dueCustomSchedules(now);

  const report: CustomReport = {
    considered: due.length,
    ran: 0,
    skippedOverCap: 0,
    failed: 0,
    notificationsSent: 0,
  };

  // Oldest first, so "your first three schedules" is stable rather than depending
  // on which happened to be due this hour.
  const perUserCount = new Map<string, number>();

  for (const schedule of due.sort((a, b) => a.id - b.id)) {
    const claimed = await db
      .update(aiCustomSchedules)
      .set({ lastRunAt: now, updatedAt: now, lastError: null })
      .where(
        and(
          eq(aiCustomSchedules.id, schedule.id),
          schedule.lastRunAt === null
            ? isNull(aiCustomSchedules.lastRunAt)
            : eq(aiCustomSchedules.lastRunAt, schedule.lastRunAt),
        ),
      )
      .returning({ id: aiCustomSchedules.id });

    if (!claimed.length) continue;

    try {
      const user = await loadSystemUser(schedule.userId);
      if (!user) continue;

      const used = perUserCount.get(schedule.userId) ?? 0;
      const allowance = entitlementsFor(
        systemContextFor(user),
      ).maxSchedules;

      if (used >= allowance) {
        report.skippedOverCap += 1;
        continue;
      }
      perUserCount.set(schedule.userId, used + 1);

      // Metered against the proactive budget like every other unattended run, so
      // three custom schedules cannot outspend the briefs.
      if (!(await consumeSystemRateLimit(schedule.userId))) {
        report.skippedOverCap += 1;
        continue;
      }

      const ctx = systemContextFor(user);
      const result = await runCustomSchedule({
        ctx,
        userId: schedule.userId,
        name: schedule.name,
        prompt: schedule.prompt,
        userName: user.name,
        locale: user.language as SupportedLocale,
      });

      report.ran += 1;

      if (result.message) {
        await deliver(
          {
            userId: schedule.userId,
            scheduleId: null,
            channel: schedule.channel,
            channelFailures: schedule.channelFailures,
          },
          {
            email: user.email,
            userName: user.name,
            title: schedule.name,
            message: result.message,
          },
        );
        report.notificationsSent += 1;
      }
    } catch (err) {
      report.failed += 1;
      log.error("custom schedule run failed", {
        userId: schedule.userId,
        scheduleId: schedule.id,
        err,
      });
      await db
        .update(aiCustomSchedules)
        .set({
          lastError: err instanceof Error ? err.message.slice(0, 500) : "unknown",
          updatedAt: new Date(),
        })
        .where(eq(aiCustomSchedules.id, schedule.id));
    }
  }

  return report;
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
      const run = RUNNERS[schedule.kind as HourGatedKind];
      if (!run) {
        log.warn("unknown schedule kind, skipping", {
          userId: schedule.userId,
          kind: schedule.kind,
        });
        return;
      }

      const sent = await run({
        userId: schedule.userId,
        scheduleId: schedule.id,
        channel: schedule.channel,
        channelFailures: schedule.channelFailures,
      });

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

  // Custom schedules run after the built-ins. Deliberate ordering: the brief is
  // the thing a Pro user is paying for, so if a sweep is going to run out of a
  // shared resource, the saved question is the one that should miss out.
  try {
    const custom = await runDueCustomSchedules(now);
    report.custom = custom;
  } catch (err) {
    log.error("custom schedule sweep failed", { err });
  }

  try {
    report.meetingPrep = await runDueMeetingPreps(now);
  } catch (err) {
    log.error("meeting prep sweep failed", { err });
  }

  return report;
}

/**
 * Run one user's brief on demand — the "send me one now" button in settings.
 *
 * Delivers through the user's configured channel rather than forcing in-app.
 * Confirming that email delivery actually works is most of why someone presses
 * this, and a preview that always arrives in the app would report success for a
 * channel it never tried.
 *
 * Failures still count toward disabling the channel. That is the right call even
 * though the user is watching: an address that bounces bounces, and pressing the
 * button three times is a clearer way to discover it than three silent mornings.
 */
export async function runBriefNow(userId: string): Promise<number> {
  const [row] = await db
    .select({
      id: aiSchedules.id,
      channel: aiSchedules.channel,
      channelFailures: aiSchedules.channelFailures,
    })
    .from(aiSchedules)
    .where(
      and(eq(aiSchedules.userId, userId), eq(aiSchedules.kind, "daily_brief")),
    )
    .limit(1);

  return runDailyBrief({
    userId,
    scheduleId: row?.id ?? null,
    // No row means the brief has never been switched on. Previewing it is still
    // reasonable, and in-app is the only channel that needs no configuration.
    channel: row?.channel ?? "app",
    channelFailures: row?.channelFailures ?? 0,
  });
}
