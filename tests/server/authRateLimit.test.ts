import { describe, it, expect } from "vitest";

import {
  checkAuthRateLimit,
  clearAuthAttempts,
  createAuthRateLimitKey,
  recordAuthFailure,
} from "~/server/authRateLimit";

/**
 * Behavioural tests for the auth rate limiter.
 *
 * These cover the primitives the credentials sign-in path relies on. Sign-in
 * does not go through tRPC, so before this it had no brute-force protection at
 * all — unbounded password guessing, and unbounded Argon2id work (64MB per
 * attempt) as a side effect.
 *
 * The limiter keeps state in a module-level Map, so every test uses a unique key
 * to stay independent of the others.
 */

let seq = 0;
const uniqueKey = (label: string) =>
  createAuthRateLimitKey("test", `${label}-${seq++}@example.com`);

describe("createAuthRateLimitKey", () => {
  it("namespaces by action so different actions don't share a budget", () => {
    expect(createAuthRateLimitKey("login", "a@b.com")).not.toBe(
      createAuthRateLimitKey("login_ip", "a@b.com"),
    );
  });

  it("lower-cases the identifier so casing can't multiply the budget", () => {
    expect(createAuthRateLimitKey("login", "User@Example.COM")).toBe(
      createAuthRateLimitKey("login", "user@example.com"),
    );
  });
});

describe("checkAuthRateLimit", () => {
  it("allows an untouched key and reports the full budget", () => {
    const status = checkAuthRateLimit(uniqueKey("fresh"));

    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(status.limit);
  });

  it("does not consume the budget — it is a pure read", () => {
    const key = uniqueKey("pure");

    const first = checkAuthRateLimit(key);
    const second = checkAuthRateLimit(key);

    expect(second.remaining).toBe(first.remaining);
    expect(second.allowed).toBe(true);
  });
});

describe("recordAuthFailure", () => {
  it("decrements the remaining budget", () => {
    const key = uniqueKey("decrement");
    const before = checkAuthRateLimit(key).remaining;

    recordAuthFailure(key);

    expect(checkAuthRateLimit(key).remaining).toBe(before - 1);
  });

  it("blocks once the limit is reached", () => {
    const key = uniqueKey("blocks");
    const { limit } = checkAuthRateLimit(key);

    for (let i = 0; i < limit; i++) {
      expect(checkAuthRateLimit(key).allowed).toBe(true);
      recordAuthFailure(key);
    }

    const status = checkAuthRateLimit(key);
    expect(status.allowed).toBe(false);
    expect(status.remaining).toBe(0);
  });

  it("never reports a negative remaining count", () => {
    const key = uniqueKey("floor");
    const { limit } = checkAuthRateLimit(key);

    for (let i = 0; i < limit + 5; i++) recordAuthFailure(key);

    expect(checkAuthRateLimit(key).remaining).toBe(0);
  });

  it("does not throw — the sign-in path must return null, not raise", () => {
    const key = uniqueKey("nothrow");
    const { limit } = checkAuthRateLimit(key);

    // `consumeAuthRateLimit` throws a TRPCError, which is wrong inside NextAuth's
    // `authorize`. This primitive exists precisely so that path can stay quiet.
    expect(() => {
      for (let i = 0; i < limit + 3; i++) recordAuthFailure(key);
    }).not.toThrow();
  });

  it("keeps separate budgets per key, so one account can't lock out another", () => {
    const victim = uniqueKey("victim");
    const other = uniqueKey("other");
    const { limit } = checkAuthRateLimit(victim);

    for (let i = 0; i < limit; i++) recordAuthFailure(victim);

    expect(checkAuthRateLimit(victim).allowed).toBe(false);
    expect(checkAuthRateLimit(other).allowed).toBe(true);
  });
});

describe("clearAuthAttempts", () => {
  it("restores the full budget after a successful sign-in", () => {
    const key = uniqueKey("clear");
    const { limit } = checkAuthRateLimit(key);

    for (let i = 0; i < limit; i++) recordAuthFailure(key);
    expect(checkAuthRateLimit(key).allowed).toBe(false);

    clearAuthAttempts(key);

    const status = checkAuthRateLimit(key);
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(limit);
  });

  it("is safe to call on a key that was never recorded", () => {
    expect(() => clearAuthAttempts(uniqueKey("absent"))).not.toThrow();
  });
});
