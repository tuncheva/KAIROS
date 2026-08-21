/**
 * POST /api/internal/ai/run-schedules — the scheduled-AI tick.
 *
 * Machine-to-machine only. The ws-server scheduler calls this because the agent
 * layer is `server-only` and must run inside the Next.js server runtime, while
 * the only long-lived process in the deployment is the socket server. Rather than
 * duplicate the agents into that process — or teach it to resolve `server-only` —
 * the clock lives there and the work lives here.
 *
 * Authentication is the shared `WS_SECRET`, the same credential the two processes
 * already use for `/internal/emit` in the other direction. That matters more here
 * than it does there: this endpoint runs work *as* arbitrary users, so an
 * unauthenticated caller would be an authorization bypass for the whole
 * application, not just a way to send a spurious socket event.
 *
 * Three properties keep that safe:
 *
 * 1. The secret is compared in constant time, and a missing or short secret
 *    disables the endpoint outright rather than defaulting to open.
 * 2. It takes no user id. The caller cannot ask for a run as a chosen person;
 *    the set of users is derived entirely from `ai_schedules` rows those users
 *    created themselves.
 * 3. Each run still passes through every normal authorization check — the
 *    synthetic context grants a user's own identity and nothing more.
 */

import crypto from "node:crypto";

import { createLogger } from "~/server/logger";
import { runDueSchedules } from "~/server/llm/scheduled/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.internal.ai");

/** Constant-time compare that does not leak length through an early return. */
function secretMatches(provided: string | null): boolean {
  const expected = process.env.WS_SECRET;

  // No secret configured means the endpoint is closed, not open.
  if (!expected || expected.length < 32) return false;
  if (!provided) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-ws-secret"))) {
    // Deliberately terse: an internal endpoint tells an unauthenticated caller
    // nothing about whether it exists or what it does.
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const report = await runDueSchedules();
    return Response.json({ ok: true, ...report });
  } catch (err) {
    log.error("scheduled sweep failed", { err });
    return Response.json(
      { ok: false, error: "Scheduled sweep failed" },
      { status: 500 },
    );
  }
}
