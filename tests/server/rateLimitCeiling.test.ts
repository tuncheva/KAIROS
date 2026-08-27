/**
 * Per-plan request ceilings.
 *
 * The limiter used to read one number from the environment into a module
 * constant, which is correct for a single global limit and wrong the moment two
 * plans differ. What is tested here is the arithmetic around the ceiling rather
 * than the sliding window itself — the window has its own store and its own
 * tests, and the interesting failures are at the edges of the comparison.
 *
 * The downgrade case is the one worth having. A user on 200/day with 40 hits in
 * the window who drops to 15/day is legitimately over the new ceiling, and the
 * honest subtraction gives -25. Rendered in a UI that is "-25 requests left",
 * which reads as a bug in the product rather than as a plan change.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sliding window is Redis-backed in production and a module-level store
 * otherwise; either way it is not what is under test. Replacing it keeps these
 * assertions about the ceiling and makes "40 hits already recorded" a one-line
 * fixture rather than forty calls.
 */
const state = { count: 0, oldest: null as number | null };

vi.mock("~/server/security/slidingWindow", () => ({
  readWindow: () => Promise.resolve({ count: state.count, oldest: state.oldest }),
  recordHit: () =>
    Promise.resolve({ count: state.count + 1, oldest: state.oldest }),
}));

const { checkRateLimit, consumeRateLimit } = await import(
  "~/server/security/rateLimit"
);

beforeEach(() => {
  state.count = 0;
  state.oldest = null;
});

describe("checkRateLimit — the ceiling comes from the caller", () => {
  it("reports the limit it was given", () => {
    return expect(checkRateLimit("user_1", 200)).resolves.toMatchObject({
      limit: 200,
      remaining: 200,
      allowed: true,
    });
  });

  it("reports a different limit for a different plan", async () => {
    const free = await checkRateLimit("user_1", 15);
    expect(free.limit).toBe(15);
    expect(free.remaining).toBe(15);
  });

  it("subtracts what has already been used", async () => {
    state.count = 10;

    await expect(checkRateLimit("user_1", 15)).resolves.toMatchObject({
      remaining: 5,
      allowed: true,
    });
  });

  it("allows the request that lands exactly on the ceiling minus one", async () => {
    // Off-by-one at the boundary is the classic bug here: with a limit of 15 and
    // 14 used, the 15th request must be permitted.
    state.count = 14;

    await expect(checkRateLimit("user_1", 15)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("refuses once the ceiling is reached", async () => {
    state.count = 15;

    await expect(checkRateLimit("user_1", 15)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });
});

describe("checkRateLimit — downgrade", () => {
  it("never reports negative remaining", async () => {
    // 40 hits against a 15/day plan. The subtraction is -25; the answer must be 0.
    state.count = 40;

    const status = await checkRateLimit("user_1", 15);

    expect(status.remaining).toBe(0);
    expect(status.remaining).toBeGreaterThanOrEqual(0);
    expect(status.allowed).toBe(false);
  });

  it("still reports the new plan's limit, not the old usage", async () => {
    state.count = 40;

    await expect(checkRateLimit("user_1", 15)).resolves.toMatchObject({
      limit: 15,
    });
  });
});

describe("consumeRateLimit", () => {
  it("throws once the plan ceiling is reached", async () => {
    state.count = 15;

    await expect(consumeRateLimit("user_1", 15)).rejects.toThrow();
  });

  it("permits the same usage on a higher plan", async () => {
    // The same window, the same user, a different plan — and now allowed. This is
    // the whole point of threading the limit through.
    state.count = 15;

    await expect(consumeRateLimit("user_1", 200)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("names the caller's own limit in the refusal", async () => {
    // The message quotes `status.limit`. If that were still the env default, a
    // free user would be told they may send 50 a day.
    state.count = 15;

    await expect(consumeRateLimit("user_1", 15)).rejects.toThrow(/15/);
  });
});
