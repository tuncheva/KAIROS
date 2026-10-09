/**
 * What an event change says to the people it affects.
 *
 * Two code paths change events: the tRPC router, when a person clicks, and the
 * A4 events publisher, when the agent acts for that person. The router was the
 * only one that told anybody — the agent's edits, cancellations, comments and
 * RSVPs landed silently. Both now call these helpers, so a change reads the same
 * on the bell and on the lock screen whichever way it was made.
 *
 * Everything here goes through `notify` / `notifyMany`, so preferences, the
 * self-skip and Web Push all apply, and nothing here throws.
 */

import { eq } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { eventCoHosts, eventComments, events, users } from "~/server/db/schema";
import { notify, notifyMany } from "./dispatch";

type Db = typeof Database;

type RsvpStatus = "going" | "maybe" | "not_going";

/**
 * How an RSVP reads to the people hosting the event.
 *
 * A decline is worth telling the hosts about — it changes their headcount — but
 * it is framed as information rather than as good news.
 */
const RSVP_TITLES: Record<RsvpStatus, string> = {
  going: "New attendee",
  maybe: "A tentative reply",
  not_going: "Someone can't make it",
};

const RSVP_PHRASES: Record<RsvpStatus, string> = {
  going: "is going to",
  maybe: "might attend",
  not_going: "can't make",
};

async function actorName(db: Db, userId: string): Promise<string> {
  const actor = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true },
  });
  return actor?.name ?? "Someone";
}

/**
 * The event's title and everyone hosting it: the owner plus every co-host.
 *
 * Co-hosts run the event alongside the owner, so a comment or an RSVP is as much
 * their news as the owner's. Only the owner used to hear about either.
 */
async function eventHosts(
  db: Db,
  eventId: number,
): Promise<{ title: string; createdById: string; hostIds: string[] } | null> {
  const [row] = await db
    .select({ createdById: events.createdById, title: events.title })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return null;

  const coHosts = await db
    .select({ userId: eventCoHosts.userId })
    .from(eventCoHosts)
    .where(eq(eventCoHosts.eventId, eventId));

  return {
    title: row.title,
    createdById: row.createdById,
    hostIds: [...new Set([row.createdById, ...coHosts.map((c) => c.userId)])],
  };
}

/**
 * A new comment, or a reply to one.
 *
 * `replyToCommentId` is the comment the actor answered, not the top of the
 * thread. Its author hears "replied to your comment"; the hosts hear "commented
 * on". Nobody hears both: a host whose own comment was answered gets only the
 * reply, because that is the more specific of the two.
 */
export async function notifyEventComment(
  db: Db,
  input: { eventId: number; actorId: string; replyToCommentId?: number | null },
): Promise<void> {
  const event = await eventHosts(db, input.eventId);
  if (!event) return;

  const name = await actorName(db, input.actorId);
  const link = `/events/${input.eventId}`;

  let replyTo: string | null = null;
  if (input.replyToCommentId) {
    const [parent] = await db
      .select({ createdById: eventComments.createdById })
      .from(eventComments)
      .where(eq(eventComments.id, input.replyToCommentId))
      .limit(1);
    // Answering yourself is not news to anybody, least of all you.
    if (parent && parent.createdById !== input.actorId) replyTo = parent.createdById;
  }

  if (replyTo) {
    await notify({
      db,
      userId: replyTo,
      actorId: input.actorId,
      category: "social",
      type: "reply",
      title: "New reply to your comment",
      message: `${name} replied to your comment on "${event.title}"`,
      link,
    });
  }

  await notifyMany({
    db,
    userIds: event.hostIds.filter((id) => id !== replyTo),
    actorId: input.actorId,
    category: "social",
    type: "comment",
    title: "New comment on your event",
    message: `${name} commented on "${event.title}"`,
    link,
  });
}

/** A like. The owner only — a like is a reaction to the post, not to the work. */
export async function notifyEventLike(
  db: Db,
  input: { eventId: number; actorId: string },
): Promise<void> {
  const [eventRow] = await db
    .select({ createdById: events.createdById, title: events.title })
    .from(events)
    .where(eq(events.id, input.eventId))
    .limit(1);
  if (!eventRow || eventRow.createdById === input.actorId) return;

  const name = await actorName(db, input.actorId);

  await notify({
    db,
    userId: eventRow.createdById,
    actorId: input.actorId,
    category: "social",
    type: "like",
    title: "New like on your event",
    message: `${name} liked your event "${eventRow.title}"`,
    link: `/events/${input.eventId}`,
    // Likes arrive in bursts on a popular post; one bell entry per
    // unread window is enough to make the point.
    coalesceWindowMs: 10 * 60 * 1000,
  });
}

/**
 * A new or changed RSVP. Callers decide whether the status actually changed —
 * re-saving the same answer is not news and must not reach this function.
 */
export async function notifyEventRsvp(
  db: Db,
  input: { eventId: number; actorId: string; status: RsvpStatus },
): Promise<void> {
  const event = await eventHosts(db, input.eventId);
  if (!event) return;

  const name = await actorName(db, input.actorId);

  await notifyMany({
    db,
    userIds: event.hostIds,
    actorId: input.actorId,
    category: "eventRsvp",
    type: "event",
    title: RSVP_TITLES[input.status],
    message: `${name} ${RSVP_PHRASES[input.status]} "${event.title}"`,
    link: `/events/${input.eventId}`,
  });
}

/** People who were just made co-hosts. Pass only the newly added ids. */
export async function notifyCoHostsAdded(
  db: Db,
  input: { eventId: number; eventTitle: string; actorId: string; userIds: string[] },
): Promise<void> {
  if (input.userIds.length === 0) return;

  await notifyMany({
    db,
    userIds: input.userIds,
    actorId: input.actorId,
    category: "eventUpdate",
    type: "event",
    title: "You are co-hosting an event",
    message: `You were added as a co-host of "${input.eventTitle}".`,
    link: `/events/${input.eventId}`,
  });
}

/**
 * A material change, told to every subscriber.
 *
 * Only material edits belong here. A fixed typo in the description, or a swapped
 * cover image, is not worth a notification to everyone who signed up. A moved
 * date or a moved place is the whole reason a person wants to be told anything.
 * `locationMoved` covers the region as well as the venue and street address —
 * to a guest those are one question: where do I go?
 */
export async function notifyEventChanged(
  db: Db,
  input: {
    eventId: number;
    eventTitle: string;
    actorId: string;
    subscribers: string[];
    dateMoved: boolean;
    locationMoved: boolean;
  },
): Promise<void> {
  const changes = [
    input.dateMoved ? "a new date" : null,
    input.locationMoved ? "a new location" : null,
  ].filter(Boolean);
  if (changes.length === 0) return;

  await notifyMany({
    db,
    userIds: input.subscribers,
    actorId: input.actorId,
    category: "eventUpdate",
    type: "event",
    title: "Event updated",
    message: `"${input.eventTitle}" now has ${changes.join(" and ")}.`,
    link: `/events/${input.eventId}`,
  });
}

/**
 * A cancellation. `subscribers` must be read *before* the delete: the RSVP rows
 * cascade away with the event, so asking afterwards always returns nobody.
 */
export async function notifyEventCancelled(
  db: Db,
  input: { eventTitle: string; actorId: string; subscribers: string[] },
): Promise<void> {
  await notifyMany({
    db,
    userIds: input.subscribers,
    actorId: input.actorId,
    category: "eventUpdate",
    type: "event",
    title: "Event cancelled",
    message: `"${input.eventTitle}" has been cancelled by the organiser.`,
    // No anchor: the event is gone, so a deep link would land on nothing.
    link: "/publish",
  });
}
