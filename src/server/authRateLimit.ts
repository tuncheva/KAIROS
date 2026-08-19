/**
 * Rate limiter for authentication endpoints to prevent brute-force attacks.
 *
 * More aggressive than the AI rate limiter:
 * - 5 attempts per 15-minute window per email/IP combination
 * - Separate tracking for different auth actions
 */

import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum attempts per sliding window */
const MAX_AUTH_ATTEMPTS = 5;

/** Sliding window duration in milliseconds (15 minutes) */
const AUTH_WINDOW_MS = 15 * 60 * 1000;

/** Cleanup interval — prune stale entries every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** key (email or IP) → sorted array of attempt timestamps (epoch ms) */
const authAttemptLog = new Map<string, number[]>();

// Periodic cleanup of expired entries to prevent memory leaks
if (typeof globalThis !== "undefined") {
  const existing = (globalThis as Record<string, unknown>).__kairosAuthRateLimitCleanup;
  if (!existing) {
    const interval = setInterval(() => {
      const cutoff = Date.now() - AUTH_WINDOW_MS;
      for (const [key, timestamps] of authAttemptLog) {
        const valid = timestamps.filter((ts) => ts > cutoff);
        if (valid.length === 0) {
          authAttemptLog.delete(key);
        } else {
          authAttemptLog.set(key, valid);
        }
      }
    }, CLEANUP_INTERVAL_MS);
    // Unref so the timer doesn't prevent process exit
    if (typeof interval === "object" && "unref" in interval) {
      interval.unref();
    }
    (globalThis as Record<string, unknown>).__kairosAuthRateLimitCleanup = true;
  }
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

/**
 * Check auth rate limit for a key (email or IP) WITHOUT consuming an attempt.
 */
export function checkAuthRateLimit(key: string): AuthRateLimitStatus {
  const now = Date.now();
  const cutoff = now - AUTH_WINDOW_MS;
  const timestamps = authAttemptLog.get(key) ?? [];
  const valid = timestamps.filter((ts) => ts > cutoff);
  const remaining = Math.max(0, MAX_AUTH_ATTEMPTS - valid.length);
  const oldestInWindow = valid[0] ?? now;
  const resetsAt = new Date(oldestInWindow + AUTH_WINDOW_MS);

  return {
    allowed: valid.length < MAX_AUTH_ATTEMPTS,
    remaining,
    limit: MAX_AUTH_ATTEMPTS,
    resetsAt,
  };
}

/**
 * Consume one auth attempt for a key. Throws TRPC TOO_MANY_REQUESTS if limit exceeded.
 */
export function consumeAuthRateLimit(key: string): AuthRateLimitStatus {
  const status = checkAuthRateLimit(key);

  if (!status.allowed) {
    const minutesRemaining = Math.ceil((status.resetsAt.getTime() - Date.now()) / 60000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many attempts. Please try again in ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}.`,
    });
  }

  const now = Date.now();
  const cutoff = now - AUTH_WINDOW_MS;
  const existing = authAttemptLog.get(key) ?? [];
  const valid = existing.filter((ts) => ts > cutoff);
  valid.push(now);
  authAttemptLog.set(key, valid);

  return {
    allowed: true,
    remaining: Math.max(0, MAX_AUTH_ATTEMPTS - valid.length),
    limit: MAX_AUTH_ATTEMPTS,
    resetsAt: status.resetsAt,
  };
}

/**
 * Create a rate limit key combining action and identifier.
 * This allows separate limits for different auth actions.
 */
export function createAuthRateLimitKey(action: string, identifier: string): string {
  return `${action}:${identifier.toLowerCase()}`;
}

/**
 * Record one failed attempt against a key, without throwing.
 *
 * `consumeAuthRateLimit` throws a TRPCError, which is the right shape for tRPC
 * procedures but not for NextAuth's `authorize` — that must return `null` to
 * signal a failed sign-in. Sign-in also counts only *failures*, so a user who
 * legitimately signs in several times in a window is never locked out.
 */
export function recordAuthFailure(key: string): void {
  const now = Date.now();
  const cutoff = now - AUTH_WINDOW_MS;
  const valid = (authAttemptLog.get(key) ?? []).filter((ts) => ts > cutoff);
  valid.push(now);
  authAttemptLog.set(key, valid);
}

/**
 * Clear recorded attempts for a key. Called after a successful sign-in so a
 * few mistyped passwords don't count against the user afterwards.
 */
export function clearAuthAttempts(key: string): void {
  authAttemptLog.delete(key);
}
