/**
 * A request context for work no user is currently making a request for.
 *
 * Every tool, context builder and authorization helper in the agent layer takes
 * a `TRPCContext` and reads the caller's identity from `ctx.session`. Scheduled
 * runs have no incoming request and therefore no session, so one is constructed
 * here — for exactly one user, from a row that was just read out of the database.
 *
 * This is a privileged capability and it is deliberately confined to this file.
 * Two properties keep it safe:
 *
 * 1. **It is never reachable from a request.** The only caller is the runner,
 *    behind an endpoint gated on the shared internal secret. Nothing in the
 *    browser can ask for a context that is not its own.
 * 2. **It grants nothing extra.** The context carries the user's real id and
 *    nothing else, so every downstream authorization check — `assertProjectAccess`,
 *    the membership lookups, the note lock — applies exactly as it would if that
 *    person had asked the question themselves. A scheduled brief can see what its
 *    subject can see, and not one row more.
 */

import "server-only";

import { eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";

export interface SystemUser {
  id: string;
  name: string | null;
  email: string | null;
  language: string;
}

export async function loadSystemUser(
  userId: string,
): Promise<SystemUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      language: users.language,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

/**
 * Build a context that acts as the given user.
 *
 * `headers` is empty rather than forged: nothing downstream reads it for
 * authorization, and an invented `x-forwarded-for` would only make audit logs
 * lie about where the request came from.
 */
export function systemContextFor(user: SystemUser): TRPCContext {
  return {
    db,
    // Never an API-key request: a scheduled run has no inbound request at all.
    apiKeyId: null,
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: null,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
    headers: new Headers(),
  } as TRPCContext;
}
