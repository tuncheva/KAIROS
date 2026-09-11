/**
 * Retrieve a live Google Calendar access token for a user, refreshing if needed.
 *
 * Returns null when the user has no connected calendar, when the token cannot
 * be decrypted, or when the refresh fails — all of which mean the same thing
 * to the caller: tell the user to reconnect.
 */
import "server-only";

import { eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { calendarConnections } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { refreshAccessToken } from "~/server/calendar/google";
import { decryptToken, encryptToken } from "~/server/calendar/tokens";

const log = createLogger("llm.calendarToken");

export interface CalendarAccess {
  accessToken: string;
  scope: string | null;
  timeZone: string | null;
}

export async function getCalendarAccess(
  ctx: TRPCContext,
  userId: string,
): Promise<CalendarAccess | null> {
  const [conn] = await ctx.db
    .select({
      id: calendarConnections.id,
      accessToken: calendarConnections.accessToken,
      refreshToken: calendarConnections.refreshToken,
      tokenSalt: calendarConnections.tokenSalt,
      accessTokenExpiresAt: calendarConnections.accessTokenExpiresAt,
      scope: calendarConnections.scope,
    })
    .from(calendarConnections)
    .where(eq(calendarConnections.userId, userId))
    .limit(1);

  if (!conn) return null;

  const stillValid =
    conn.accessTokenExpiresAt !== null &&
    conn.accessTokenExpiresAt.getTime() > Date.now();

  if (stillValid) {
    const token = decryptToken(conn.accessToken, conn.tokenSalt);
    if (token) return { accessToken: token, scope: conn.scope ?? null, timeZone: null };
  }

  if (!conn.refreshToken) return null;
  const refresh = decryptToken(conn.refreshToken, conn.tokenSalt);
  if (!refresh) return null;

  try {
    const newTokens = await refreshAccessToken(refresh);
    const encrypted = encryptToken(newTokens.accessToken, conn.tokenSalt);
    await ctx.db
      .update(calendarConnections)
      .set({
        accessToken: encrypted,
        accessTokenExpiresAt: newTokens.expiresAt,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, conn.id));
    return { accessToken: newTokens.accessToken, scope: conn.scope ?? null, timeZone: null };
  } catch (err) {
    log.warn("calendar token refresh failed", { userId, err });
    return null;
  }
}
