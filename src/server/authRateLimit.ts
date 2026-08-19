/**
 * Rate limiter for authentication endpoints, to slow brute-force attacks.
 *
 * More aggressive than the AI limiter: 5 attempts per 15-minute sliding window
 * per key, where a key is an action plus an identifier (an email or a client IP),
 * so signup, password-reset requests, code verification and sign-in each get
 * their own budget.
 *
 * State lives in `~/server/slidingWindow`, which is Redis-backed when
 * `REDIS_NATIVE_URL` is set. It used to be a module-level `Map`: with more than
 * one app instance the effective limit multiplied by instance count, and every
 * deploy handed attackers a fresh budget.
 */

import { TRPCError } from "@trpc/server";

import { clearWindow, readWindow, recordHit } from "~/server/slidingWindow";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum attempts per sliding window. */
const MAX_AUTH_ATTEMPTS = 5;

/** Sliding window duration in milliseconds (15 minutes). */
const AUTH_WINDOW_MS = 15 * 60 * 1000;

function storeKey(key: string): string {
  return `auth:${key}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AuthRateLimitStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetsAt: Date;
}

function toStatus(
  count: number,
  oldest: number | null,
  now: number,
): AuthRateLimitStatus {
  return {
    allowed: count < MAX_AUTH_ATTEMPTS,
    remaining: Math.max(0, MAX_AUTH_ATTEMPTS - count),
    limit: MAX_AUTH_ATTEMPTS,
    resetsAt: new Date((oldest ?? now) + AUTH_WINDOW_MS),
  };
}

/** Read a key's budget without consuming an attempt. */
export async function checkAuthRateLimit(
  key: string,
): Promise<AuthRateLimitStatus> {
  const now = Date.now();
  const { count, oldest } = await readWindow(storeKey(key), AUTH_WINDOW_MS, now);
  return toStatus(count, oldest, now);
}

/**
 * Consume one attempt.
 *
 * @throws TRPCError TOO_MANY_REQUESTS when the window is full.
 */
export async function consumeAuthRateLimit(
  key: string,
): Promise<AuthRateLimitStatus> {
  const status = await checkAuthRateLimit(key);

  if (!status.allowed) {
    const minutesRemaining = Math.ceil(
      (status.resetsAt.getTime() - Date.now()) / 60000,
    );
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many attempts. Please try again in ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.`,
    });
  }

  const now = Date.now();
  const { count, oldest } = await recordHit(
    storeKey(key),
    AUTH_WINDOW_MS,
    now,
  );
  return { ...toStatus(count, oldest, now), allowed: true };
}

/**
 * Create a rate limit key combining an action and an identifier, so different
 * auth actions get separate budgets.
 */
export function createAuthRateLimitKey(
  action: string,
  identifier: string,
): string {
  return `${action}:${identifier.toLowerCase()}`;
}

/**
 * Record one failed attempt without throwing.
 *
 * `consumeAuthRateLimit` throws a TRPCError, which is the right shape for a tRPC
 * procedure but not for NextAuth's `authorize` — that must return `null` to
 * signal a failed sign-in. Sign-in also counts only *failures*, so someone who
 * legitimately signs in repeatedly is never locked out.
 */
export async function recordAuthFailure(key: string): Promise<void> {
  await recordHit(storeKey(key), AUTH_WINDOW_MS);
}

/**
 * Clear recorded attempts for a key, after a successful sign-in, so a few
 * mistyped passwords don't count against the user afterwards.
 */
export async function clearAuthAttempts(key: string): Promise<void> {
  await clearWindow(storeKey(key));
}
