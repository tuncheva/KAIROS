/**
 * Web Push: the lock-screen copy of a notification.
 *
 * `dispatch.ts` decides whether a notification reaches a user at all; this module
 * only carries an already-delivered one to the devices that user enabled push on.
 * So push follows every category toggle in Settings for free, and there is no
 * second gate to keep in sync.
 *
 * The payload is Declarative Web Push (`web_push: 8030`, Safari 18.4+). Safari
 * shows it even if the service worker fails, and every other browser — older
 * iOS, Android, desktop — receives the same JSON in the worker's `push` event,
 * which reads that shape. One format, no user-agent sniffing on the server.
 */

import { and, count, eq, inArray } from "drizzle-orm";
import webpush, { type WebPushError } from "web-push";

import { env } from "~/env";
import type { db as Database } from "~/server/db";
import { notifications, pushSubscriptions } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

const log = createLogger("notifications.push");

type Db = typeof Database;

export interface PushItem {
  userId: string;
  /** The bell row this mirrors, so a tap can mark it read. Absent for tests. */
  notificationId?: number | null;
  title: string;
  message: string;
  link?: string | null;
}

/**
 * Apple caps the encrypted payload at 4 KB. These limits keep the JSON far
 * below that even when every character is a multi-byte Cyrillic one.
 */
const MAX_TITLE = 120;
const MAX_BODY = 400;

function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

function appOrigin(): string {
  return (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** `link` is always an in-app path; anything else falls back to the app root. */
export function absoluteUrl(link: string | null | undefined, origin = appOrigin()): string {
  if (!link?.startsWith("/") || link.startsWith("//")) return `${origin}/`;
  return `${origin}${link}`;
}

export interface PushPayload {
  web_push: 8030;
  notification: {
    title: string;
    body: string;
    navigate: string;
    app_badge?: string;
    data: { notificationId: number | null; url: string };
  };
}

export function buildPushPayload(
  item: Omit<PushItem, "userId"> & { unreadCount?: number },
  origin?: string,
): PushPayload {
  const url = absoluteUrl(item.link, origin);
  return {
    web_push: 8030,
    notification: {
      title: truncate(item.title || "KAIROS", MAX_TITLE),
      body: truncate(item.message, MAX_BODY),
      navigate: url,
      ...(item.unreadCount !== undefined ? { app_badge: String(item.unreadCount) } : {}),
      data: { notificationId: item.notificationId ?? null, url },
    },
  };
}

function vapidSubject(): string {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  const origin = env.NEXT_PUBLIC_APP_URL;
  return origin?.startsWith("https://") ? origin : "mailto:push@kairos.invalid";
}

let configured: boolean | null = null;

/** Whether push is set up on this deployment. Unset keys mean "in-app only". */
export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = vapidSubject();
  if (!publicKey || !privateKey) {
    configured = false;
    return configured;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    log.error("invalid VAPID configuration; push disabled", { err });
    configured = false;
  }
  return configured;
}

/** Test hook: forget the cached configuration so env changes take effect. */
export function resetPushConfigForTests() {
  configured = null;
}

async function unreadCounts(db: Db, userIds: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: notifications.userId, n: count() })
    .from(notifications)
    .where(and(inArray(notifications.userId, userIds), eq(notifications.read, false)))
    .groupBy(notifications.userId);
  return new Map(rows.map((r) => [r.userId, Number(r.n)]));
}

function isGone(err: unknown): boolean {
  const status = (err as Partial<WebPushError> | null)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Send each item to every device its user subscribed. Never throws: like the
 * socket emit beside it, push is a courtesy on top of a notification that has
 * already been stored, and a slow or failing push service must not surface as a
 * failed mutation.
 */
export async function sendPushToUsers(
  db: Db,
  items: PushItem[],
  opts: { badge?: boolean } = {},
): Promise<{ sent: number; failed: number; removed: number }> {
  const result = { sent: 0, failed: 0, removed: 0 };
  if (items.length === 0 || !isPushConfigured()) return result;

  try {
    const userIds = [...new Set(items.map((i) => i.userId))];
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));
    if (subs.length === 0) return result;

    const badges = opts.badge === false ? new Map<string, number>() : await unreadCounts(db, userIds);

    const sends = items.flatMap((item) => {
      const payload = JSON.stringify(
        buildPushPayload({
          ...item,
          unreadCount: opts.badge === false ? undefined : (badges.get(item.userId) ?? 0),
        }),
      );
      return subs
        .filter((s) => s.userId === item.userId)
        .map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
              { TTL: 60 * 60 * 24, urgency: "high" },
            );
            result.sent++;
            return { id: sub.id, ok: true as const };
          } catch (err) {
            result.failed++;
            if (isGone(err)) return { id: sub.id, ok: false as const, gone: true };
            log.warn("push send failed", {
              status: (err as Partial<WebPushError>).statusCode,
              body: (err as Partial<WebPushError>).body,
              host: new URL(sub.endpoint).host,
            });
            return { id: sub.id, ok: false as const, gone: false };
          }
        });
    });

    const outcomes = await Promise.all(sends);
    const goneIds = outcomes.filter((o) => !o.ok && o.gone).map((o) => o.id);
    const okIds = [...new Set(outcomes.filter((o) => o.ok).map((o) => o.id))];

    if (goneIds.length > 0) {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, goneIds));
      result.removed = goneIds.length;
    }
    if (okIds.length > 0) {
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date() })
        .where(inArray(pushSubscriptions.id, okIds));
    }
  } catch (err) {
    log.error("push delivery failed", { err });
  }

  return result;
}
