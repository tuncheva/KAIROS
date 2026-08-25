/**
 * Pulling a connected calendar into the product.
 *
 * Read-only, incremental, and idempotent. Each pass either uses the stored sync
 * token — in which case Google returns only what changed — or does a bounded full
 * pull when there is no token or the token has expired.
 *
 * Idempotence matters more here than in most sync code, because the same event
 * arrives repeatedly: an incremental sync reports an event again every time
 * anything about it changes, and a full re-pull reports everything. Every write
 * is therefore an upsert keyed on `(connectionId, externalId)`, so re-running a
 * sync converges rather than duplicating.
 */

import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { db } from "~/server/db";
import { calendarConnections, externalEvents } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import {
  listEvents,
  mapEvent,
  refreshAccessToken,
} from "./google";
import { decryptToken, encryptToken } from "./tokens";

const log = createLogger("calendar.sync");

/** Consecutive failures before a connection is marked as needing attention. */
const MAX_FAILURES = 5;

/**
 * How long a cancelled event is kept.
 *
 * Kept at all so an incremental sync can turn a meeting off rather than leaving a
 * stale row, and so a brief that already mentioned a meeting can say it was
 * cancelled. Culled eventually because a cancelled event from March is noise.
 */
const CANCELLED_RETENTION_DAYS = 14;

export interface SyncReport {
  imported: number;
  updated: number;
  cancelled: number;
  skipped: number;
  fullResync: boolean;
  error: string | null;
}

/**
 * Ensure the connection has a usable access token, refreshing if needed.
 *
 * Returns null when the connection can no longer be used — no refresh token, a
 * token that will not decrypt, or a refresh Google refuses. In every one of those
 * cases the answer for the user is the same (reconnect), so they are not
 * distinguished to the caller.
 */
async function usableAccessToken(connection: {
  id: number;
  accessToken: string;
  refreshToken: string | null;
  tokenSalt: string;
  accessTokenExpiresAt: Date | null;
}): Promise<string | null> {
  const stillValid =
    connection.accessTokenExpiresAt !== null &&
    connection.accessTokenExpiresAt.getTime() > Date.now();

  if (stillValid) {
    const token = decryptToken(connection.accessToken, connection.tokenSalt);
    if (token) return token;
  }

  if (!connection.refreshToken) return null;

  const refresh = decryptToken(connection.refreshToken, connection.tokenSalt);
  if (!refresh) return null;

  try {
    const fresh = await refreshAccessToken(refresh);

    await db
      .update(calendarConnections)
      .set({
        accessToken: encryptToken(fresh.accessToken, connection.tokenSalt),
        // Only overwrite the refresh token when Google sent a new one. A refresh
        // response routinely omits it, and writing null would destroy the one
        // credential that cannot be recovered without the user re-consenting.
        ...(fresh.refreshToken
          ? {
              refreshToken: encryptToken(
                fresh.refreshToken,
                connection.tokenSalt,
              ),
            }
          : {}),
        accessTokenExpiresAt: fresh.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connection.id));

    return fresh.accessToken;
  } catch (err) {
    log.warn("calendar token refresh failed", {
      connectionId: connection.id,
      err,
    });
    return null;
  }
}

/**
 * Sync one connection.
 *
 * Never throws. Failures are recorded on the connection row, because the callers
 * are a background sweep and a user-triggered "sync now" — neither of which can
 * do anything useful with an exception, and both of which need the reason to be
 * visible in the product afterwards.
 */
export async function syncConnection(connectionId: number): Promise<SyncReport> {
  const empty: SyncReport = {
    imported: 0,
    updated: 0,
    cancelled: 0,
    skipped: 0,
    fullResync: false,
    error: null,
  };

  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!connection) return { ...empty, error: "Connection not found" };

  const fail = async (message: string): Promise<SyncReport> => {
    const failures = connection.failureCount + 1;
    await db
      .update(calendarConnections)
      .set({
        lastError: message.slice(0, 500),
        failureCount: failures,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connectionId));

    if (failures >= MAX_FAILURES) {
      log.warn("calendar connection failing repeatedly", {
        connectionId,
        failures,
      });
    }
    return { ...empty, error: message };
  };

  const accessToken = await usableAccessToken(connection);
  if (!accessToken) {
    return fail("Calendar access expired. Reconnect the calendar.");
  }

  let result;
  try {
    result = await listEvents({
      accessToken,
      syncToken: connection.syncToken,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Sync failed");
  }

  // Google expired the sync token. Not a failure: discard it and pull fully.
  if (result.syncTokenExpired) {
    await db
      .update(calendarConnections)
      .set({ syncToken: null, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));

    try {
      result = await listEvents({ accessToken, syncToken: null });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Full resync failed");
    }
  }

  const report: SyncReport = {
    ...empty,
    fullResync: connection.syncToken === null,
  };

  for (const raw of result.events) {
    const mapped = mapEvent(raw);
    if (!mapped) {
      report.skipped += 1;
      continue;
    }

    // Upsert, because the same event arrives on every sync where anything about
    // it changed — and again in full on a resync.
    const written = await db
      .insert(externalEvents)
      .values({
        connectionId,
        userId: connection.userId,
        externalId: mapped.externalId,
        title: mapped.title,
        description: mapped.description,
        location: mapped.location,
        startsAt: mapped.startsAt,
        endsAt: mapped.endsAt,
        allDay: mapped.allDay,
        status: mapped.status,
        attendeeCount: mapped.attendeeCount,
        selfResponse: mapped.selfResponse,
      })
      .onConflictDoUpdate({
        target: [externalEvents.connectionId, externalEvents.externalId],
        set: {
          title: mapped.title,
          description: mapped.description,
          location: mapped.location,
          startsAt: mapped.startsAt,
          endsAt: mapped.endsAt,
          allDay: mapped.allDay,
          status: mapped.status,
          attendeeCount: mapped.attendeeCount,
          selfResponse: mapped.selfResponse,
          updatedAt: new Date(),
        },
      })
      .returning({ id: externalEvents.id });

    if (mapped.status === "cancelled") report.cancelled += 1;
    else if (written.length) report.imported += 1;
    else report.updated += 1;
  }

  // Cull long-cancelled rows. Bounded by date rather than by count so the query
  // is an index scan rather than a sort of the whole table.
  await db
    .delete(externalEvents)
    .where(
      and(
        eq(externalEvents.connectionId, connectionId),
        eq(externalEvents.status, "cancelled"),
        lt(
          externalEvents.startsAt,
          new Date(Date.now() - CANCELLED_RETENTION_DAYS * 86_400_000),
        ),
      ),
    );

  await db
    .update(calendarConnections)
    .set({
      syncToken: result.nextSyncToken ?? connection.syncToken,
      lastSyncedAt: new Date(),
      lastError: null,
      failureCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, connectionId));

  log.info("calendar synced", { connectionId, ...report });
  return report;
}
