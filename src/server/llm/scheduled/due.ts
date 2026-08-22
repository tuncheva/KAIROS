/**
 * When a scheduled agent is due.
 *
 * Split from the runner for one reason: the runner imports the database client,
 * which reads validated server env at module load, so importing it from a unit
 * test costs a live configuration. This rule is the load-bearing part of the
 * sweep and the part that was wrong for every user outside UTC, so it should be
 * cheap to test — and it needs nothing but a clock and a zone.
 */

import "server-only";

import { DEFAULT_TIME_ZONE, localDayKeyIn, localHourIn } from "~/lib/timezone";

/** The parts of a schedule that decide whether it should run. */
export interface DueCheck {
  hourLocal: number;
  lastRunAt: Date | null;
  timeZone: string | null;
}

/**
 * Should this schedule run at this instant?
 *
 * Exported and pure so the rule can be tested without a database behind it —
 * this is the decision the whole module exists to make, and it is the one that
 * was silently wrong for every user outside UTC.
 *
 * Two conditions, both evaluated in the user's own zone:
 *
 * 1. The local hour has reached the hour they asked for.
 * 2. It has not already run on their current local day.
 *
 * The second compares calendar-day keys rather than an instant against a
 * computed local midnight. On the two DST days a year those differ by an hour,
 * and an hour's error there is the difference between one brief and two — or
 * between one and none.
 */
export function isScheduleDue(schedule: DueCheck, now: Date): boolean {
  const zone = schedule.timeZone ?? DEFAULT_TIME_ZONE;

  if (localHourIn(zone, now) < schedule.hourLocal) return false;
  if (!schedule.lastRunAt) return true;

  return localDayKeyIn(zone, schedule.lastRunAt) !== localDayKeyIn(zone, now);
}
