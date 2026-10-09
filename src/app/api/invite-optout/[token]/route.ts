/**
 * POST /api/invite-optout/:token — "Don't send me KAIROS invitations again".
 *
 * Unauthenticated by design: the person opting out has, typically, no account.
 * The signed token is the credential — it carries a keyed hash of the address
 * and a signature over it, never the address (see `~/server/orgs/invitePolicy`).
 *
 * POST only. A GET that suppressed would be triggered by every mail scanner and
 * link-preview bot that prefetches the email's links; RFC 8058 one-click
 * unsubscribe, which mail clients use via `List-Unsubscribe-Post`, is a POST.
 */

import { db } from "~/server/db";
import { createLogger } from "~/server/logger";
import { suppressByToken } from "~/server/orgs/invitePolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.invite-optout");

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  try {
    const ok = await suppressByToken(db, decodeURIComponent(token));
    return new Response(null, { status: ok ? 204 : 400 });
  } catch (err) {
    log.error("invite opt-out failed", { err });
    return new Response(null, { status: 500 });
  }
}
