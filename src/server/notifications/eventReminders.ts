/**
 * The sweep that makes "remind me before this event" mean something.
 *
 * `event_rsvp` has carried `reminder_minutes_before` and `reminder_sent` for as
 * long as the RSVP dialog has offered a reminder dropdown. Nothing read either
 * column. A user could subscribe to an event, ask to be reminded 30 minutes
 * before, and the row recorded the request faithfully — then the event started
 * and no reminder was ever sent, because no code path existed to send one.
 *
 * This runs on the existing scheduled tick rather than a cron of its own; see
 * the route that calls it for why that tick is the only clock in the deployment.
 */

import { and, asc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { events, eventRsvps } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { notify } from "~/server/notifications/dispatch";

const log = createLogger("notifications.eventReminders");

/**
 * Reminders more than this far past their moment are dropped rather than sent.
 *
 * Without a floor, a tick that has not run for two days would fire a burst of
 * "starting in 30 minutes" notices for events that finished yesterday. A missed
 * reminder is a small failure; a wrong one erodes trust in every later reminder.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Bounded so one sweep cannot become an unbounded write burst. */
const MAX_PER_SWEEP = 500;

export interface ReminderReport {
  considered: number;
  sent: number;
  /** Due, marked handled, but not delivered — the recipient has these switched off. */
  skipped: number;
}

/**
 * Send every event reminder that has come due.
 *
 * A row is due when `now >= eventDate - reminderMinutesBefore`. The comparison is
 * done in SQL so the filter runs on an index-eligible expression rather than by
 * loading every future RSVP into the process.
 */
export async function sendDueEventReminders(now = new Date()): Promise<ReminderReport> {
  const dueRows = await db
    .select({
      rsvpId: eventRsvps.id,
      userId: eventRsvps.userId,
      eventId: events.id,
      eventTitle: events.title,
      eventDate: events.eventDate,
    })
    .from(eventRsvps)
    .innerJoin(events, eq(eventRsvps.eventId, events.id))
    .where(
      and(
        eq(eventRsvps.reminderSent, false),
        isNotNull(eventRsvps.reminderMinutesBefore),
        // Declining an event cancels its reminder. Without this, changing an RSVP
        // to `not_going` left the reminder armed.
        sql`${eventRsvps.status} <> 'not_going'`,
        // Due: the reminder moment has passed.
        lte(
          sql`${events.eventDate} - (${eventRsvps.reminderMinutesBefore} * interval '1 minute')`,
          now,
        ),
        // But the event itself has not long since gone by.
        gte(events.eventDate, new Date(now.getTime() - STALE_AFTER_MS)),
      ),
    )
    .orderBy(asc(events.eventDate))
    .limit(MAX_PER_SWEEP);

  const report: ReminderReport = {
    considered: dueRows.length,
    sent: 0,
    skipped: 0,
  };

  for (const row of dueRows) {
    const minutesToStart = Math.round((row.eventDate.getTime() - now.getTime()) / 60_000);

    const result = await notify({
      db,
      userId: row.userId,
      category: "eventReminder",
      type: "event_reminder",
      title: "Event starting soon",
      message:
        minutesToStart > 0
          ? `"${row.eventTitle}" starts in ${formatLead(minutesToStart)}.`
          : `"${row.eventTitle}" is starting now.`,
      link: `/publish#event-${row.eventId}`,
    });

    // The flag is set whether or not the notification was delivered. A user who
    // has event reminders switched off should not accumulate a backlog that all
    // fires the moment they switch them back on.
    await db
      .update(eventRsvps)
      .set({ reminderSent: true })
      .where(eq(eventRsvps.id, row.rsvpId));

    if (result.delivered) report.sent += 1;
    else report.skipped += 1;
  }

  if (report.considered > 0) {
    log.info("event reminder sweep", { ...report });
  }

  return report;
}

/** "45 minutes", "2 hours", "1 day" — whichever unit reads most naturally. */
function formatLead(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
