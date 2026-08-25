/**
 * GET /api/calendar/google/connect — begin calendar authorisation.
 *
 * A redirect, not an API call, because the browser has to visit Google. The
 * user's own session is what authorises starting the flow.
 *
 * `state` is an HMAC over the user id and a timestamp, signed with `AUTH_SECRET`.
 * That is the CSRF defence for the callback: without it, an attacker could send
 * a victim a crafted callback URL carrying the attacker's authorisation code and
 * bind the attacker's calendar to the victim's account. Signing the user id means
 * the callback can verify *who* started the flow rather than trusting whoever
 * arrives with a code.
 */

import { auth } from "~/server/auth";
import { authorizationUrl, isGoogleCalendarConfigured } from "~/server/calendar/google";
import { signState } from "~/server/calendar/state";

// Re-exported so the callback keeps one import site for the flow's helpers.
export { STATE_TTL_MS, signState, verifyState } from "~/server/calendar/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!isGoogleCalendarConfigured()) {
    // A missing client id is a deployment gap, not a user error. Said plainly so
    // whoever hits it in dev knows what to configure.
    return new Response(
      "Google calendar is not configured on this deployment.",
      { status: 503 },
    );
  }

  const state = signState(session.user.id, Date.now());

  return Response.redirect(authorizationUrl(state), 302);
}
