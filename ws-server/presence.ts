/**
 * Who is online right now.
 *
 * This process is the only one that knows: presence is a property of live socket
 * connections, and the Next.js app server never sees them. So it is tracked here
 * in memory rather than written to the database on every connect and disconnect
 * — a write per tab open would be a lot of traffic for a fact that is stale the
 * moment the process restarts anyway.
 *
 * Two details the naive version gets wrong:
 *
 *  - **A user is not a socket.** One person with three tabs open is three
 *    sockets. Presence is refcounted per user id, so closing one tab does not
 *    broadcast that they went offline while two are still connected.
 *
 *  - **A refresh is not a departure.** A page reload disconnects and reconnects
 *    within a second or so. Going offline is therefore delayed by
 *    `OFFLINE_GRACE_MS`, and a reconnect inside that window cancels it, so the
 *    dot does not blink on every navigation.
 */

import type { Server } from "socket.io";

import { createLogger } from "./logger";

const log = createLogger("ws:presence");

/** How long a user may be disconnected before anyone is told they left. */
const OFFLINE_GRACE_MS = 3_000;

/** Live socket count per user. A user is online while this is above zero. */
const connectionCount = new Map<string, number>();

/** Pending "went offline" broadcasts, keyed by user, cancellable on reconnect. */
const pendingOffline = new Map<string, NodeJS.Timeout>();

export function onlineUserIds(): string[] {
  return Array.from(connectionCount.keys());
}

export function isOnline(userId: string): boolean {
  return (connectionCount.get(userId) ?? 0) > 0;
}

/**
 * Record a new connection, and announce arrival only on the first one.
 *
 * Announcing on every socket would republish "online" for a user who never went
 * away, once per tab.
 */
export function trackConnect(io: Server, userId: string): void {
  const pending = pendingOffline.get(userId);
  if (pending) {
    clearTimeout(pending);
    pendingOffline.delete(userId);
  }

  const next = (connectionCount.get(userId) ?? 0) + 1;
  connectionCount.set(userId, next);

  if (next === 1) {
    broadcast(io, userId, true);
    log.debug("user online", { userId });
  }
}

/** Record a disconnect, and schedule the departure if it was the last socket. */
export function trackDisconnect(io: Server, userId: string): void {
  const next = (connectionCount.get(userId) ?? 1) - 1;
  if (next > 0) {
    connectionCount.set(userId, next);
    return;
  }

  connectionCount.delete(userId);

  const timer = setTimeout(() => {
    pendingOffline.delete(userId);
    /* Re-check: `trackConnect` clears this timer on reconnect, but a connect
       racing the timer's own execution could otherwise mark a live user away. */
    if (isOnline(userId)) return;
    broadcast(io, userId, false);
    log.debug("user offline", { userId });
  }, OFFLINE_GRACE_MS);

  /* Do not hold the process open for a presence timer during shutdown. */
  timer.unref?.();
  pendingOffline.set(userId, timer);
}

/**
 * Presence is broadcast to every connected client.
 *
 * It is not sensitive — it is one boolean about someone the viewer can already
 * see in their org — and scoping it per organization would mean a membership
 * lookup on every connect and disconnect.
 */
function broadcast(io: Server, userId: string, online: boolean): void {
  io.emit("presence:update", { userId, online });
}

/** Clear all state. Only for tests — production tracks a single live process. */
export function resetPresence(): void {
  for (const timer of pendingOffline.values()) clearTimeout(timer);
  pendingOffline.clear();
  connectionCount.clear();
}
