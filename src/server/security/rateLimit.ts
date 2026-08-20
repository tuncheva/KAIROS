/**
 * Sliding-window rate limiter for AI agent requests.
 *
 * Limit: 50 AI requests per user per 24-hour sliding window (`AI_RATE_LIMIT`).
 * Covers every agent mutation that calls the LLM — A1 drafts, A2/A3/A4 drafts,
 * task generation, PDF extraction. Confirm and apply are not limited: they only
 * write the already-generated plan and cost nothing at the model.
 *
 * State lives in `~/server/security/slidingWindow`, which is Redis-backed when
 * `REDIS_NATIVE_URL` is set. It used to be a module-level `Map`, which meant the
 * limit multiplied by instance count and reset on deploy — for a limiter whose job
 * is capping spend, that was the weakest link.
 */

import { TRPCError } from "@trpc/server";

import { readWindow, recordHit } from "~/server/security/slidingWindow";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum AI requests per user per sliding window. */
const MAX_REQUESTS_PER_WINDOW = parseInt(process.env.AI_RATE_LIMIT ?? "50", 10);

/** Sliding window duration in milliseconds (24 hours). */
const WINDOW_MS = 24 * 60 * 60 * 1000;

function key(userId: string): string {
  return `ai:${userId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetsAt: Date;
}

function toStatus(
  count: number,
  oldest: number | null,
  now: number,
): RateLimitStatus {
  return {
    allowed: count < MAX_REQUESTS_PER_WINDOW,
    remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - count),
    limit: MAX_REQUESTS_PER_WINDOW,
    // The window slides, so budget frees up when the oldest hit ages out.
    resetsAt: new Date((oldest ?? now) + WINDOW_MS),
  };
}

/** Read a user's remaining budget without consuming any of it. */
export async function checkRateLimit(userId: string): Promise<RateLimitStatus> {
  const now = Date.now();
  const { count, oldest } = await readWindow(key(userId), WINDOW_MS, now);
  return toStatus(count, oldest, now);
}

/**
 * Consume one request.
 *
 * @throws TRPCError TOO_MANY_REQUESTS when the window is full.
 */
export async function consumeRateLimit(
  userId: string,
): Promise<RateLimitStatus> {
  const status = await checkRateLimit(userId);

  if (!status.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `You've reached your limit for messages to KAIROS. You can send ${status.limit} AI messages per day. Try again after ${status.resetsAt.toLocaleTimeString()}.`,
    });
  }

  const now = Date.now();
  const { count, oldest } = await recordHit(key(userId), WINDOW_MS, now);
  return { ...toStatus(count, oldest, now), allowed: true };
}
