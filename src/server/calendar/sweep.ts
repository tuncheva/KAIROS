/**
 * Keeping connected calendars current.
 *
 * Without this the feature is a one-shot: a calendar is pulled once at connect
 * and then silently goes stale, which is worse than not having it — a
 * meeting-prep brief built on a week-old snapshot is confidently wrong about
 * today.
 *
 * Rides on the same hourly tick as the scheduled agents rather than getting a
 * cron of its own, for the same reasons the history cull does: one thing to
 * configure, one thing to monitor, one thing to forget.
 *
 * There is no row-claiming here, unlike the schedule sweep. It is not needed:
 * every write `syncConnection` performs is an upsert keyed on
 * `(connectionId, externalId)`, so two overlapping ticks converge on the same
 * state rather than duplicating rows. The cost of a double run is a wasted
 * request, not corrupt data — and a claim would add a write per connection per
 * tick to prevent something harmless.
 */

import "server-only";

import { and, isNull, lt, or } from "drizzle-orm";

import { db } from "~/server/db";
import { calendarConnections } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import { syncConnection } from "./sync";

const log = createLogger("calendar.sweep");

/**
 * How stale a connection may get before it is refreshed.
 *
 * Under an hour so that an hourly tick always finds due connections rather than
 * skipping every other one on clock jitter.
 */
const STALE_AFTER_MS = 50 * 60 * 1000;

/** Connections processed per tick, so one sweep cannot run unbounded. */
const BATCH = 100;

/** Concurrent syncs. These are outbound HTTP calls, not database work. */
const CONCURRENCY = 4;

/**
 * How many consecutive failures before a connection is left alone.
 *
 * A calendar whose grant was revoked at Google fails identically forever, and
 * retrying it hourly is a request per hour per dead connection that can never
 * succeed. Past this it waits for the user to reconnect — which clears the count.
 */
const GIVE_UP_AFTER = 10;

export interface CalendarSweepReport {
  considered: number;
  synced: number;
  failed: number;
  imported: number;
}

export async function syncDueCalendars(
  now = new Date(),
): Promise<CalendarSweepReport> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);

  const due = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(
      and(
        or(
          isNull(calendarConnections.lastSyncedAt),
          lt(calendarConnections.lastSyncedAt, cutoff),
        ),
        lt(calendarConnections.failureCount, GIVE_UP_AFTER),
      ),
    )
    .limit(BATCH);

  const report: CalendarSweepReport = {
    considered: due.length,
    synced: 0,
    failed: 0,
    imported: 0,
  };

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const slice = due.slice(i, i + CONCURRENCY);

    await Promise.all(
      slice.map(async (connection) => {
        try {
          // `syncConnection` does not throw — it records failures on the row —
          // so this catch is for the unexpected rather than the expected.
          const result = await syncConnection(connection.id);

          if (result.error) {
            report.failed += 1;
            return;
          }

          report.synced += 1;
          report.imported += result.imported;
        } catch (err) {
          report.failed += 1;
          log.error("calendar sync threw", { connectionId: connection.id, err });
        }
      }),
    );
  }

  if (report.considered > 0) {
    log.info("calendar sweep complete", { ...report });
  }

  return report;
}
