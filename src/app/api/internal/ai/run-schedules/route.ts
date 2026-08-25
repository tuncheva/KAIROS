/**
 * POST /api/internal/ai/run-schedules — the scheduled-AI tick.
 *
 * Machine-to-machine only. The ws-server scheduler calls this because the agent
 * layer is `server-only` and must run inside the Next.js server runtime, while
 * the only long-lived process in the deployment is the socket server. Rather than
 * duplicate the agents into that process — or teach it to resolve `server-only` —
 * the clock lives there and the work lives here.
 *
 * Authentication is the shared `WS_SECRET`, the same credential the two processes
 * already use for `/internal/emit` in the other direction. That matters more here
 * than it does there: this endpoint runs work *as* arbitrary users, so an
 * unauthenticated caller would be an authorization bypass for the whole
 * application, not just a way to send a spurious socket event.
 *
 * Three properties keep that safe:
 *
 * 1. The secret is compared in constant time, and a missing or short secret
 *    disables the endpoint outright rather than defaulting to open.
 * 2. It takes no user id. The caller cannot ask for a run as a chosen person;
 *    the set of users is derived entirely from `ai_schedules` rows those users
 *    created themselves.
 * 3. Each run still passes through every normal authorization check — the
 *    synthetic context grants a user's own identity and nothing more.
 */

import crypto from "node:crypto";

import type { TRPCContext } from "~/server/api/trpc";
import { entitlementsFor } from "~/server/billing/entitlements";
import { db } from "~/server/db";
import { createLogger } from "~/server/logger";
import {
  cullExpiredHistory,
  type CullReport,
} from "~/server/llm/retention";
import {
  syncDueCalendars,
  type CalendarSweepReport,
} from "~/server/calendar/sweep";
import { runDueSchedules } from "~/server/llm/scheduled/runner";
import { sendDueEventReminders } from "~/server/notifications/eventReminders";
import {
  rearmMovedTaskReminders,
  sendDueTaskReminders,
} from "~/server/notifications/taskReminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.internal.ai");

/** Constant-time compare that does not leak length through an early return. */
function secretMatches(provided: string | null): boolean {
  const expected = process.env.WS_SECRET;

  // No secret configured means the endpoint is closed, not open.
  if (!expected || expected.length < 32) return false;
  if (!provided) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-ws-secret"))) {
    // Deliberately terse: an internal endpoint tells an unauthenticated caller
    // nothing about whether it exists or what it does.
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const report = await runDueSchedules();

    /* Event reminders ride this tick for the same reasons history retention does
       below: same cadence, same authentication, same "runs while nobody is
       watching" profile. Before this, the only thing driving them was a
       `setInterval` in a client component calling a mutation that did nothing —
       so a user who asked to be reminded 30 minutes before an event was reminded
       never.

       Failure is reported but does not fail the request. A retried sweep would
       re-send reminders that already went out, which is worse than a late one. */
    let eventReminders: Awaited<ReturnType<typeof sendDueEventReminders>> | { error: string };
    try {
      eventReminders = await sendDueEventReminders();
    } catch (err) {
      log.error("event reminder sweep failed", { err });
      eventReminders = { error: "Event reminder sweep failed" };
    }

    /* Task due reminders — the other switch that governed nothing. Re-arming runs
       first so a task whose deadline was pushed out is eligible again in the same
       tick rather than the next one. */
    let taskReminders:
      | (Awaited<ReturnType<typeof sendDueTaskReminders>> & { rearmed: number })
      | { error: string };
    try {
      const rearmed = await rearmMovedTaskReminders();
      taskReminders = { ...(await sendDueTaskReminders()), rearmed };
    } catch (err) {
      log.error("task reminder sweep failed", { err });
      taskReminders = { error: "Task reminder sweep failed" };
    }

    // History retention rides along on this tick rather than getting a cron of
    // its own. It is the same cadence, the same authentication, and the same
    // "runs while nobody is watching" risk profile — a second scheduler would be
    // a second thing to configure, monitor and forget.
    //
    // Its failure is reported but does not fail the request: a cull that did not
    // run is a bounded amount of extra data kept for another hour, where a 500
    // here would make the caller retry the briefs it has already sent.
    let retention: CullReport | { error: string };
    try {
      retention = await cullExpiredHistory({
        resolveHistoryDays: (userId) =>
          entitlementsFor({
            db,
            apiKeyId: null,
            session: { user: { id: userId } },
          } as TRPCContext).historyDays,
      });
    } catch (err) {
      log.error("history cull failed", { err });
      retention = { error: "History cull failed" };
    }

    // Calendars ride the same tick. Without this the feature is a one-shot: a
    // calendar is pulled at connect and then silently goes stale, and a
    // meeting-prep brief built on a week-old snapshot is confidently wrong.
    //
    // Isolated like the cull above, for the same reason: a calendar provider
    // being down must not fail a request whose briefs have already been sent.
    let calendars: CalendarSweepReport | { error: string };
    try {
      calendars = await syncDueCalendars();
    } catch (err) {
      log.error("calendar sweep failed", { err });
      calendars = { error: "Calendar sweep failed" };
    }

    return Response.json({
      ok: true,
      ...report,
      eventReminders,
      taskReminders,
      retention,
      calendars,
    });
  } catch (err) {
    log.error("scheduled sweep failed", { err });
    return Response.json(
      { ok: false, error: "Scheduled sweep failed" },
      { status: 500 },
    );
  }
}
