/**
 * GET /api/calendar/feed/{token}.ics — a calendar you subscribe to.
 *
 * `/api/export/ics` hands you a file. The moment it is imported it begins
 * going stale, and a calendar that is quietly wrong is worse than no calendar
 * at all: it tells you about a meeting that moved. A subscription URL is the
 * shape Google, Apple and Outlook already understand, and they fetch it from
 * their own servers on their own schedule.
 *
 * Which is why the URL is the credential. There is no session cookie on those
 * requests and no way to put one there, so the token in the path is what
 * authenticates. It follows that:
 *
 * - It is looked up in constant work by a unique index, not compared in a loop.
 * - It is never logged. The URL is the secret, so a URL in a log file is a
 *   leaked calendar.
 * - It is rotatable from Settings, because the alternative to revoking a
 *   leaked feed cannot be deleting the account.
 * - The response is `private, no-store`. A shared cache holding one user's
 *   calendar against a guessable-looking path is the failure this is built to
 *   avoid.
 *
 * Unlike the export route this is not paywalled. It is the same data the user
 * can already download as ICS on every plan; charging for the useful shape of
 * something already free reads as a toll rather than a feature.
 */

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import type { TRPCContext } from "~/server/api/trpc";
import { users } from "~/server/db/schema";
import { collectExport } from "~/server/export/collect";
import { toIcs } from "~/server/export/formatters";
import { createLogger } from "~/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.calendar.feed");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Subscribers append `.ics` because some clients decide how to parse a feed
  // from the extension before they have read a byte of it.
  const value = token.replace(/\.ics$/i, "");

  /* Length-checked before the query: the column is 64 characters and a token
     is generated at exactly that, so anything else is a probe and does not
     need a round trip. */
  if (value.length !== 64) {
    return new Response("Not found", { status: 404 });
  }

  const owner = await db.query.users.findFirst({
    where: eq(users.calendarFeedToken, value),
    columns: { id: true },
  });

  /* 404, not 401. A 401 confirms the token was well-formed but wrong, which
     tells someone enumerating that they are close. */
  if (!owner) {
    return new Response("Not found", { status: 404 });
  }

  /* The same synthetic context the export route builds, and for the same
     reason: `collectExport` takes a `TRPCContext` so it shares
     `loadVisibleScope` with the agent layer, which is what makes the scoping
     here trustworthy rather than a second guess at it. There is no session —
     the token stood in for one — so the shape carries the resolved user only. */
  const ctx = {
    db,
    session: { user: { id: owner.id }, expires: "" },
    apiKeyId: null,
    headers: new Headers(),
  } as unknown as TRPCContext;

  try {
    const bundle = await collectExport(ctx, owner.id);
    const body = toIcs(bundle);

    // `userId`, never the token.
    log.info("calendar feed served", {
      userId: owner.id,
      events: bundle.events.length,
      tasks: bundle.tasks.length,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="kairos.ics"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    log.error("calendar feed failed", { userId: owner.id, err });
    return new Response("Could not build the calendar", { status: 500 });
  }
}
