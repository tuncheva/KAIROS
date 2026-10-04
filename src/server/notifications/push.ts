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
import { after } from "next/server";
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

/**
 * The origin push links point at. Declarative Web Push (iOS 18.4+) opens
 * `navigate` itself, so a wrong origin here is a dead tap on the phone: fall
 * back to Vercel's production domain, then the https VAPID subject, before
 * the localhost default that only makes sense in development.
 */
function appOrigin(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const subject = clean(env.VAPID_SUBJECT);
  const origin =
    env.NEXT_PUBLIC_APP_URL ??
    (vercel ? `https://${vercel}` : undefined) ??
    (subject?.startsWith("https://") ? subject : undefined) ??
    "http://localhost:3000";
  return origin.replace(/\/+$/, "");
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

/**
 * Dashboard-pasted secrets arrive with quotes, spaces or a trailing newline
 * often enough that rejecting them outright made push silently "unavailable"
 * on a deploy whose keys were otherwise right.
 */
function clean(value: string | undefined): string | undefined {
  const v = value?.trim().replace(/^["']|["']$/g, "").trim();
  return v?.length ? v : undefined;
}

/** web-push wants `mailto:` or an absolute https URL; accept a bare domain too. */
function vapidSubject(): string {
  const raw = clean(env.VAPID_SUBJECT);
  if (raw) {
    if (/^(mailto:|https?:\/\/)/i.test(raw)) return raw;
    if (raw.includes("@")) return `mailto:${raw}`;
    return `https://${raw.replace(/^\/+/, "")}`;
  }
  const origin = env.NEXT_PUBLIC_APP_URL;
  return origin?.startsWith("https://") ? origin : "mailto:push@kairos.invalid";
}

let configured: boolean | null = null;

/** Why push is off, for the settings screen and the logs. Null when it is on. */
export type PushConfigProblem = "missing-public-key" | "missing-private-key" | "invalid-keys" | null;
let problem: PushConfigProblem = null;

/** Whether push is set up on this deployment. Unset keys mean "in-app only". */
export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = clean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const privateKey = clean(env.VAPID_PRIVATE_KEY);
  if (!publicKey || !privateKey) {
    problem = publicKey ? "missing-private-key" : "missing-public-key";
    log.warn("push disabled: VAPID key not set", { problem });
    configured = false;
    return configured;
  }
  try {
    webpush.setVapidDetails(vapidSubject(), publicKey, privateKey);
    problem = null;
    configured = true;
  } catch (err) {
    problem = "invalid-keys";
    log.error("invalid VAPID configuration; push disabled", {
      message: err instanceof Error ? err.message : String(err),
    });
    configured = false;
  }
  return configured;
}

export function pushConfigProblem(): PushConfigProblem {
  isPushConfigured();
  return problem;
}

/** Test hook: forget the cached configuration so env changes take effect. */
export function resetPushConfigForTests() {
  configured = null;
  problem = null;
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

/**
 * Send after the response, without losing the send on serverless hosts.
 *
 * A bare `void sendPushToUsers(...)` is fine on a long-lived Node server, but on
 * Vercel the function is frozen once the response is sent, and a push still in
 * flight to Apple simply never goes out. `after` keeps the invocation alive
 * until it settles while still not delaying the response. Outside a request
 * (scripts, tests) `after` throws, and plain fire-and-forget is the right
 * behaviour there anyway.
 */
export function schedulePush(db: Db, items: PushItem[]): void {
  if (items.length === 0) return;
  try {
    after(() => sendPushToUsers(db, items));
  } catch {
    void sendPushToUsers(db, items);
  }
}
