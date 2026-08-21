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

/**
 * Record a model call the user did not directly ask for.
 *
 * One chat message can cost several completions: a JSON repair round, a retry
 * after truncation, or each iteration of the tool loop. Those were invisible to
 * the limiter, so a 50/day budget could bill three times that upstream.
 *
 * Deliberately records without checking. Refusing here would abort a request
 * that is already half-done — the budget is enforced at the door, in
 * {@link consumeRateLimit}, and the overshoot is bounded by the loop's own
 * iteration cap.
 */
export async function recordExtraAiCall(userId: string): Promise<void> {
  await recordHit(key(userId), WINDOW_MS, Date.now());
}

// ---------------------------------------------------------------------------
// B-4 — the system budget
// ---------------------------------------------------------------------------

/**
 * Scheduled runs are metered separately from what the user asks for.
 *
 * A daily brief that quietly ate one of the user's 50 requests would be a
 * feature charging the person it was supposed to help — and worse, it would do
 * it before they woke up, so the budget they found at 9am would already be down.
 * Proactive work therefore draws on its own window and can never touch the
 * interactive one.
 *
 * The reverse also holds: a user who exhausts their interactive budget still
 * gets tomorrow's brief.
 */
const MAX_SYSTEM_REQUESTS_PER_WINDOW = parseInt(
  process.env.AI_SYSTEM_RATE_LIMIT ?? "20",
  10,
);

function systemKey(userId: string): string {
  return `ai:system:${userId}`;
}

export async function checkSystemRateLimit(
  userId: string,
): Promise<RateLimitStatus> {
  const now = Date.now();
  const { count, oldest } = await readWindow(systemKey(userId), WINDOW_MS, now);
  return {
    allowed: count < MAX_SYSTEM_REQUESTS_PER_WINDOW,
    remaining: Math.max(0, MAX_SYSTEM_REQUESTS_PER_WINDOW - count),
    limit: MAX_SYSTEM_REQUESTS_PER_WINDOW,
    resetsAt: new Date((oldest ?? now) + WINDOW_MS),
  };
}

/**
 * Consume one scheduled run.
 *
 * Returns `false` rather than throwing: a scheduler iterating hundreds of users
 * wants to skip this one and carry on, not unwind a batch.
 */
export async function consumeSystemRateLimit(userId: string): Promise<boolean> {
  const status = await checkSystemRateLimit(userId);
  if (!status.allowed) return false;
  await recordHit(systemKey(userId), WINDOW_MS, Date.now());
  return true;
}
