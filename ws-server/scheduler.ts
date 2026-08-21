/**
 * B-0 — the clock.
 *
 * KAIROS had no server-side scheduler at all. `EventReminderService.tsx` is a
 * `"use client"` component running `setInterval` in the browser, so even event
 * reminders only fired while somebody happened to have a tab open — and nothing
 * proactive could exist at all.
 *
 * This process is the natural home: it is already long-lived, already has the
 * shared secret, and is already the thing that stays up when every browser is
 * closed. What it deliberately does *not* do is run the agents. Those are
 * `server-only` modules that belong to the Next.js runtime, so the tick is an
 * authenticated HTTP call into the app rather than a second copy of the agent
 * layer maintained here.
 *
 * The tick is intentionally dumb: fire every few minutes, let the app decide who
 * is actually due. Putting the "who" logic behind the database — where
 * `lastRunAt` is claimed transactionally — means two schedulers, or a scheduler
 * restarted mid-tick, cannot double-send.
 */

import { createLogger } from "./logger";

const log = createLogger("scheduler");

/**
 * How often to ask the app whether anyone is due.
 *
 * Five minutes: fine-grained enough that an 07:00 brief arrives by 07:05, coarse
 * enough that a day of ticks is ~290 requests that almost always find nothing.
 */
const TICK_INTERVAL_MS = 5 * 60 * 1000;

/** Give a sweep plenty of room — it may run model calls for many users. */
const REQUEST_TIMEOUT_MS = 4 * 60 * 1000;

interface SweepReport {
  ok?: boolean;
  considered?: number;
  ran?: number;
  notificationsSent?: number;
  failed?: number;
}

export function startScheduler(): () => void {
  const secret = process.env.WS_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!secret || secret.length < 32) {
    log.warn("scheduler disabled: WS_SECRET is missing or too short");
    return () => undefined;
  }

  const endpoint = `${appUrl.replace(/\/+$/, "")}/api/internal/ai/run-schedules`;

  /** True while a sweep is in flight, so a slow sweep cannot overlap itself. */
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) {
      log.debug("skipping tick, previous sweep still running");
      return;
    }
    running = true;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "x-ws-secret": secret, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        log.warn("scheduled sweep returned an error", { status: res.status });
        return;
      }

      const report = (await res.json()) as SweepReport;

      // Only worth a line when something actually happened; otherwise this would
      // be 288 "considered: 0" entries a day.
      if ((report.considered ?? 0) > 0) {
        log.info("scheduled sweep", {
          considered: report.considered,
          ran: report.ran,
          notified: report.notificationsSent,
          failed: report.failed,
        });
      }
    } catch (err) {
      // The app being down or restarting is normal and temporary. The next tick
      // is five minutes away; there is nothing to recover here.
      log.warn("scheduled sweep could not reach the app", {
        endpoint,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), TICK_INTERVAL_MS);

  // Do not hold the process open on the timer alone — the socket server is what
  // keeps this process alive, and the scheduler should never be the reason a
  // shutdown hangs.
  timer.unref?.();

  log.info("scheduler started", {
    endpoint,
    intervalMinutes: TICK_INTERVAL_MS / 60_000,
  });

  return () => clearInterval(timer);
}
