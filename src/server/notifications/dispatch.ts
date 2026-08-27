/**
 * The one place a notification is created.
 *
 * Before this module, twelve call sites across six routers each hand-rolled the
 * same four steps — insert a row, emit a socket frame, skip yourself, invent a
 * synthetic id — and none of them did the fifth: ask the recipient whether they
 * wanted it. The `users` table had carried notification preference columns for a
 * long time, the settings screen wrote all of them, and no producing code read
 * any of them. Toggling "Project updates" off changed a boolean in Postgres and
 * nothing else.
 *
 * So the gate lives here rather than in the callers. A caller names a *category*
 * — what kind of thing happened — and this module decides whether that reaches
 * that user. A new notification cannot forget to check, because there is no
 * other way to create one.
 */

import { and, eq, gte, inArray } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { notifications, users } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { emitNotification } from "~/server/ws/emit";

const log = createLogger("notifications.dispatch");

type Db = typeof Database;

/** Columns this module reads. Kept narrow so the query stays cheap. */
const PREFERENCE_COLUMNS = {
  inAppNotifications: users.inAppNotifications,
  directMessageNotifications: users.directMessageNotifications,
  projectUpdatesNotifications: users.projectUpdatesNotifications,
  taskAssignmentNotifications: users.taskAssignmentNotifications,
  taskDueRemindersNotifications: users.taskDueRemindersNotifications,
  eventRemindersNotifications: users.eventRemindersNotifications,
  eventUpdatesNotifications: users.eventUpdatesNotifications,
  eventRsvpNotifications: users.eventRsvpNotifications,
  socialNotifications: users.socialNotifications,
  inviteNotifications: users.inviteNotifications,
  workspaceNotifications: users.workspaceNotifications,
} as const;

type PreferenceKey = keyof typeof PREFERENCE_COLUMNS;
type Preferences = Record<PreferenceKey, boolean>;

/**
 * What happened, from the recipient's point of view.
 *
 * Categories are deliberately about the *reason a person cares*, not about which
 * table changed. "Someone commented on my event" and "someone liked my event"
 * are one preference to a user even though they are two code paths to us.
 */
export type NotificationCategory =
  /** A direct message from another person. */
  | "directMessage"
  /** Work happened inside a project you are on: a task added, a plan changed. */
  | "projectUpdate"
  /** A task was assigned to you specifically. */
  | "taskAssignment"
  /** A task you own is approaching or past its due date. */
  | "taskDueReminder"
  /** An event you subscribed to is about to start. */
  | "eventReminder"
  /** An event you subscribed to was changed or cancelled. */
  | "eventUpdate"
  /** Somebody subscribed to, or changed their RSVP on, an event you own. */
  | "eventRsvp"
  /** A like, comment or reply on something you posted. */
  | "social"
  /** You were invited to a project or workspace, or something was shared with you. */
  | "invite"
  /** Membership and workspace administration: joins, accepted or declined invites. */
  | "workspace"
  /**
   * You asked for this specific delivery yourself — an AI brief on a schedule you
   * created. Gated only by the master in-app switch, because a per-item opt-in is
   * a stronger signal than a category default.
   */
  | "requested"
  /**
   * Account and security notices. Ungateable on purpose: a user who cannot be
   * told their password changed is worse off than a user who is over-notified.
   */
  | "security";

/**
 * The preference column that governs each category.
 *
 * `null` means "no category toggle" — see `security`, which bypasses everything,
 * and `requested`, which is still subject to the master switch below.
 */
const CATEGORY_PREFERENCE: Record<NotificationCategory, PreferenceKey | null> = {
  directMessage: "directMessageNotifications",
  projectUpdate: "projectUpdatesNotifications",
  taskAssignment: "taskAssignmentNotifications",
  taskDueReminder: "taskDueRemindersNotifications",
  eventReminder: "eventRemindersNotifications",
  eventUpdate: "eventUpdatesNotifications",
  eventRsvp: "eventRsvpNotifications",
  social: "socialNotifications",
  invite: "inviteNotifications",
  workspace: "workspaceNotifications",
  requested: null,
  security: null,
};

export type NotificationType =
  | "event"
  | "task"
  | "project"
  | "system"
  | "like"
  | "comment"
  | "reply"
  | "message"
  | "event_reminder";

export interface NotifyInput {
  db: Db;
  /** Who should receive this. */
  userId: string;
  /**
   * Who caused it. When this equals `userId` the notification is dropped — a
   * check every call site used to make for itself, and some of them forgot.
   */
  actorId?: string | null;
  category: NotificationCategory;
  /** Drives the icon in the bell. */
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  /**
   * Suppress if an unread notification with the same link already arrived inside
   * this many milliseconds. Chat had this logic inline; anything chatty wants it.
   */
  coalesceWindowMs?: number;
}

export type NotifyResult =
  | { delivered: true; id: number }
  | { delivered: false; reason: "self" | "muted" | "coalesced" | "error" };

/**
 * Whether this category may reach this user.
 *
 * Exported for the tests, which assert the precedence directly: security beats
 * the master switch, and the master switch beats every category toggle.
 */
export function isDeliverable(
  prefs: Preferences | undefined,
  category: NotificationCategory,
): boolean {
  if (category === "security") return true;

  // A missing user row means a deleted account; there is nobody to notify.
  if (!prefs) return false;
  if (!prefs.inAppNotifications) return false;

  const column = CATEGORY_PREFERENCE[category];
  if (column === null) return true;
  return prefs[column];
}

async function loadPreferences(db: Db, userIds: string[]): Promise<Map<string, Preferences>> {
  if (userIds.length === 0) return new Map();

  const rows = await db
    .select({ id: users.id, ...PREFERENCE_COLUMNS })
    .from(users)
    .where(inArray(users.id, userIds));

  return new Map(rows.map(({ id, ...prefs }) => [id, prefs as Preferences]));
}

/**
 * Deliver one notification, subject to the recipient's preferences.
 *
 * Never throws. A notification is a side effect of the thing the user actually
 * asked for, and losing one is a far smaller failure than rolling back their
 * mutation because the notification insert hit a constraint — which is the shape
 * of bug the one hand-written `try/catch` in `project.ts` was guarding against
 * while eleven other call sites were not.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  if (input.actorId && input.actorId === input.userId) {
    return { delivered: false, reason: "self" };
  }

  try {
    const prefs = (await loadPreferences(input.db, [input.userId])).get(input.userId);
    if (!isDeliverable(prefs, input.category)) {
      return { delivered: false, reason: "muted" };
    }

    if (input.coalesceWindowMs && input.link) {
      const [recent] = await input.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, input.userId),
            eq(notifications.link, input.link),
            eq(notifications.read, false),
            gte(notifications.createdAt, new Date(Date.now() - input.coalesceWindowMs)),
          ),
        )
        .limit(1);

      if (recent) return { delivered: false, reason: "coalesced" };
    }

    const [row] = await input.db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
        read: false,
      })
      .returning({ id: notifications.id });

    if (!row) return { delivered: false, reason: "error" };

    // Emitted after the row exists, so a client that reacts by refetching finds
    // it. The reverse order produced a bell that briefly showed a count of one
    // over an empty list.
    emitNotification(input.userId, {
      id: row.id,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    });

    return { delivered: true, id: row.id };
  } catch (err) {
    log.error("notification delivery failed", {
      err,
      userId: input.userId,
      category: input.category,
    });
    return { delivered: false, reason: "error" };
  }
}

/**
 * Same rules, one round trip for the preference lookup and one for the insert.
 *
 * Fan-out notifications — "a task was added to a project with nine collaborators"
 * — would otherwise issue two queries per recipient. Callers pass the whole
 * audience including the actor; the actor is filtered out here.
 */
export async function notifyMany(input: {
  db: Db;
  userIds: string[];
  actorId?: string | null;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
}): Promise<{ delivered: number; suppressed: number }> {
  const recipients = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return { delivered: 0, suppressed: 0 };

  try {
    const prefs = await loadPreferences(input.db, recipients);
    const allowed = recipients.filter((id) => isDeliverable(prefs.get(id), input.category));

    if (allowed.length === 0) {
      return { delivered: 0, suppressed: recipients.length };
    }

    const rows = await input.db
      .insert(notifications)
      .values(
        allowed.map((userId) => ({
          userId,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link ?? null,
          read: false,
        })),
      )
      .returning({ id: notifications.id, userId: notifications.userId });

    for (const row of rows) {
      emitNotification(row.userId, {
        id: row.id,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
      });
    }

    return { delivered: rows.length, suppressed: recipients.length - rows.length };
  } catch (err) {
    log.error("bulk notification delivery failed", { err, category: input.category });
    return { delivered: 0, suppressed: recipients.length };
  }
}
