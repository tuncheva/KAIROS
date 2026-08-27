/**
 * GET /api/calendar/google/callback — finish calendar authorisation.
 *
 * Google sends the browser here with a `code` and the `state` we signed. Three
 * things have to be true before a token is stored, and the order matters:
 *
 * 1. **The state verifies.** This is what binds the flow to the user who started
 *    it. Without it, a crafted callback link could attach an attacker's calendar
 *    to whoever clicks it.
 * 2. **The session agrees with the state.** Belt and braces: if someone signed
 *    into a different account mid-flow, the safe outcome is to refuse rather than
 *    to trust either half.
 * 3. **The code exchanges.** Only then is anything written.
 *
 * Ends in a redirect either way, because the user is in a browser and needs to
 * land somewhere. Failures carry a short reason in the query string so the
 * settings page can say what went wrong rather than showing a blank success.
 */

import { and, eq } from "drizzle-orm";

import { env } from "~/env";
import { auth } from "~/server/auth";
import { exchangeCode } from "~/server/calendar/google";
import { syncConnection } from "~/server/calendar/sync";
import { encryptToken, newTokenSalt } from "~/server/calendar/tokens";
import { db } from "~/server/db";
import { calendarConnections } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import { verifyState } from "../connect/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("calendar.callback");

function back(reason?: string): Response {
  const base = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = new URL("/settings", base.replace(/\/$/, ""));
  url.searchParams.set("section", "ai");
  url.searchParams.set("calendar", reason ?? "connected");
  return Response.redirect(url.toString(), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  // The user pressed Cancel on the consent screen. Not an error worth a scary
  // message — they simply changed their mind.
  if (denied) return back("cancelled");
  if (!code || !state) return back("failed");

  const verified = verifyState(state);
  if (!verified) {
    log.warn("calendar callback with an invalid state");
    return back("failed");
  }

  const session = await auth();
  if (!session?.user?.id || session.user.id !== verified.userId) {
    // Either signed out mid-flow, or the state belongs to a different account.
    log.warn("calendar callback session did not match state");
    return back("failed");
  }

  const userId = verified.userId;

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    log.error("calendar code exchange failed", { userId, err });
    return back("failed");
  }

  // No refresh token means the grant expires in an hour and cannot be renewed.
  // Refused rather than stored, because storing it would produce a connection
  // that works now and dies silently before the first scheduled sync.
  if (!tokens.refreshToken) {
    log.warn("calendar grant carried no refresh token", { userId });
    return back("no_refresh");
  }

  const salt = newTokenSalt();

  try {
    await db
      .insert(calendarConnections)
      .values({
        userId,
        provider: "google",
        accountEmail: session.user.email ?? null,
        accessToken: encryptToken(tokens.accessToken, salt),
        refreshToken: encryptToken(tokens.refreshToken, salt),
        tokenSalt: salt,
        accessTokenExpiresAt: tokens.expiresAt,
      })
      .onConflictDoUpdate({
        target: [calendarConnections.userId, calendarConnections.provider],
        set: {
          accessToken: encryptToken(tokens.accessToken, salt),
          refreshToken: encryptToken(tokens.refreshToken, salt),
          tokenSalt: salt,
          accessTokenExpiresAt: tokens.expiresAt,
          accountEmail: session.user.email ?? null,
          // A reconnection starts clean: the old sync token belonged to a grant
          // that is being replaced, and keeping it would ask Google for a delta
          // against a session it no longer recognises.
          syncToken: null,
          lastError: null,
          failureCount: 0,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    log.error("storing calendar connection failed", { userId, err });
    return back("failed");
  }

  // First sync inline, so the user sees their calendar immediately rather than
  // an empty panel until the next sweep. Failure here is not fatal — the
  // connection exists and the sweep will retry.
  try {
    const [connection] = await db
      .select({ id: calendarConnections.id })
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.userId, userId),
          eq(calendarConnections.provider, "google"),
        ),
      )
      .limit(1);

    if (connection) await syncConnection(connection.id);
  } catch (err) {
    log.warn("first calendar sync failed", { userId, err });
  }

  return back("connected");
}
