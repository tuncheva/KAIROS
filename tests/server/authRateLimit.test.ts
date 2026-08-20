import { describe, it, expect } from "vitest";

import {
  checkAuthRateLimit,
  clearAuthAttempts,
  createAuthRateLimitKey,
  recordAuthFailure,
} from "~/server/security/authRateLimit";

/**
 * Behavioural tests for the auth rate limiter.
 *
 * These cover the primitives the credentials sign-in path relies on. Sign-in
 * does not go through tRPC, so before this it had no brute-force protection at
 * all — unbounded password guessing, and unbounded Argon2id work (64MB per
 * attempt) as a side effect.
 *
 * The limiter is now backed by `~/server/security/slidingWindow`, so the whole API is
 * async. With `REDIS_NATIVE_URL` unset — as it is under test — the store falls
 * back to per-process memory, which is what these assertions exercise. Every
 * test still uses a unique key to stay independent of the others.
 */

let seq = 0;
const uniqueKey = (label: string) =>
  createAuthRateLimitKey("test", `${label}-${seq++}@example.com`);

describe("createAuthRateLimitKey", () => {
  it("namespaces by action so different actions don't share a budget", async () => {
    expect(createAuthRateLimitKey("login", "a@b.com")).not.toBe(
      createAuthRateLimitKey("login_ip", "a@b.com"),
    );
  });

  it("lower-cases the identifier so casing can't multiply the budget", async () => {
    expect(createAuthRateLimitKey("login", "User@Example.COM")).toBe(
      createAuthRateLimitKey("login", "user@example.com"),
    );
  });
});

describe("checkAuthRateLimit", () => {
  it("allows an untouched key and reports the full budget", async () => {
    const status = await checkAuthRateLimit(uniqueKey("fresh"));

    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(status.limit);
  });

  it("does not consume the budget — it is a pure read", async () => {
    const key = uniqueKey("pure");

    const first = await checkAuthRateLimit(key);
    const second = await checkAuthRateLimit(key);

    expect(second.remaining).toBe(first.remaining);
    expect(second.allowed).toBe(true);
  });
});

describe("recordAuthFailure", () => {
  it("decrements the remaining budget", async () => {
    const key = uniqueKey("decrement");
    const before = (await checkAuthRateLimit(key)).remaining;

    await recordAuthFailure(key);

    expect((await checkAuthRateLimit(key)).remaining).toBe(before - 1);
  });

  it("blocks once the limit is reached", async () => {
    const key = uniqueKey("blocks");
    const { limit } = await checkAuthRateLimit(key);

    for (let i = 0; i < limit; i++) {
      expect((await checkAuthRateLimit(key)).allowed).toBe(true);
      await recordAuthFailure(key);
    }

    const status = await checkAuthRateLimit(key);
    expect(status.allowed).toBe(false);
    expect(status.remaining).toBe(0);
  });

  it("never reports a negative remaining count", async () => {
    const key = uniqueKey("floor");
    const { limit } = await checkAuthRateLimit(key);

    for (let i = 0; i < limit + 5; i++) await recordAuthFailure(key);

    expect((await checkAuthRateLimit(key)).remaining).toBe(0);
  });

  it("does not throw — the sign-in path must return null, not raise", async () => {
    const key = uniqueKey("nothrow");
    const { limit } = await checkAuthRateLimit(key);

    // `consumeAuthRateLimit` throws a TRPCError, which is wrong inside NextAuth's
    // `authorize`. This primitive exists precisely so that path can stay quiet.
    await expect(
      (async () => {
        for (let i = 0; i < limit + 3; i++) await recordAuthFailure(key);
      })(),
    ).resolves.toBeUndefined();
  });

  it("keeps separate budgets per key, so one account can't lock out another", async () => {
    const victim = uniqueKey("victim");
    const other = uniqueKey("other");
    const { limit } = await checkAuthRateLimit(victim);

    for (let i = 0; i < limit; i++) await recordAuthFailure(victim);

    expect((await checkAuthRateLimit(victim)).allowed).toBe(false);
    expect((await checkAuthRateLimit(other)).allowed).toBe(true);
  });
});

describe("clearAuthAttempts", () => {
  it("restores the full budget after a successful sign-in", async () => {
    const key = uniqueKey("clear");
    const { limit } = await checkAuthRateLimit(key);

    for (let i = 0; i < limit; i++) await recordAuthFailure(key);
    expect((await checkAuthRateLimit(key)).allowed).toBe(false);

    await clearAuthAttempts(key);

    const status = await checkAuthRateLimit(key);
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(limit);
  });

  it("is safe to call on a key that was never recorded", async () => {
    await expect(clearAuthAttempts(uniqueKey("absent"))).resolves.toBeUndefined();
  });
});
