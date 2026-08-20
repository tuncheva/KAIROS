import { describe, it, expect, beforeEach } from "vitest";

import {
  EMAIL_VERIFICATION_TTL_MS,
  consumeVerificationToken,
  generateVerificationToken,
  hashVerificationToken,
  issueVerificationToken,
  verificationHashesMatch,
  verificationIdentifier,
} from "~/server/email/emailVerification";
import type { db as Database } from "~/server/db";

/**
 * Behavioural tests for email-verification tokens.
 *
 * This is the regression test for audit finding #7: signup stamped
 * `emailVerified: new Date()` without sending anything, so the column carried no
 * information, and OAuth account linking would then attach a real owner's
 * provider identity to whatever row already held their address.
 *
 * The database is a small in-memory stand-in for the two operations this module
 * performs on `verification_token` — insert/delete by identifier, and select by
 * token hash.
 */

type Row = { identifier: string; token: string; expires: Date };

function fakeDb() {
  let rows: Row[] = [];

  const db = {
    insert: () => ({
      values: (v: Row) => {
        rows.push({ ...v });
        return Promise.resolve();
      },
    }),
    delete: () => ({
      where: (predicate: unknown) => {
        // The module deletes either by identifier (issuing) or by
        // identifier+token (consuming). Both are modelled by the recorded filter.
        const f = filter;
        rows = rows.filter((r) => !f(r));
        void predicate;
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows.filter((r) => filter(r)).slice(0, 1)),
        }),
      }),
    }),
  };

  // The stub cannot interpret Drizzle's SQL objects, so tests set the predicate
  // that the next where() should mean. Every call site here is deterministic.
  let filter: (r: Row) => boolean = () => false;
  const setFilter = (f: (r: Row) => boolean) => {
    filter = f;
  };

  return {
    db: db as unknown as typeof Database,
    rows: () => rows,
    setFilter,
  };
}

describe("token generation", () => {
  it("produces distinct, URL-safe tokens", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes, base64url — long enough that guessing is not a strategy.
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes deterministically and does not echo the token", () => {
    const token = generateVerificationToken();
    const hash = hashVerificationToken(token);

    expect(hash).toBe(hashVerificationToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });

  it("namespaces and lower-cases the identifier", () => {
    expect(verificationIdentifier(" User@Example.COM ")).toBe(
      "email-verify:user@example.com",
    );
  });
});

describe("verificationHashesMatch", () => {
  it("matches identical hashes and rejects different ones", () => {
    const a = hashVerificationToken("one");
    const b = hashVerificationToken("two");

    expect(verificationHashesMatch(a, a)).toBe(true);
    expect(verificationHashesMatch(a, b)).toBe(false);
  });

  it("rejects a length mismatch without throwing", () => {
    expect(verificationHashesMatch("abc", hashVerificationToken("x"))).toBe(false);
  });
});

describe("issue and consume", () => {
  let harness: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    harness = fakeDb();
  });

  it("stores only the hash, never the token", async () => {
    harness.setFilter(() => false);
    const token = await issueVerificationToken(harness.db, "a@example.com");

    const stored = harness.rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token).toBe(hashVerificationToken(token));
    expect(stored[0]?.token).not.toBe(token);
  });

  it("sets a deadline one TTL out", async () => {
    harness.setFilter(() => false);
    const before = Date.now();
    await issueVerificationToken(harness.db, "a@example.com");

    const expires = harness.rows()[0]!.expires.getTime();
    expect(expires).toBeGreaterThanOrEqual(before + EMAIL_VERIFICATION_TTL_MS - 50);
  });

  it("returns the address the token proves", async () => {
    harness.setFilter(() => false);
    const token = await issueVerificationToken(harness.db, "Owner@Example.com");

    harness.setFilter((r) => r.token === hashVerificationToken(token));
    const result = await consumeVerificationToken(harness.db, token);

    expect(result).toEqual({ ok: true, email: "owner@example.com" });
  });

  it("is single-use — the row is gone after redeeming", async () => {
    harness.setFilter(() => false);
    const token = await issueVerificationToken(harness.db, "a@example.com");

    harness.setFilter((r) => r.token === hashVerificationToken(token));
    await consumeVerificationToken(harness.db, token);

    expect(harness.rows()).toHaveLength(0);

    const second = await consumeVerificationToken(harness.db, token);
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an unknown token", async () => {
    harness.setFilter(() => false);
    expect(await consumeVerificationToken(harness.db, "not-a-real-token")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an empty token without querying", async () => {
    expect(await consumeVerificationToken(harness.db, "")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("reports an expired token distinctly, and consumes it anyway", async () => {
    harness.setFilter(() => false);
    const token = await issueVerificationToken(harness.db, "a@example.com");
    harness.rows()[0]!.expires = new Date(Date.now() - 1);

    harness.setFilter((r) => r.token === hashVerificationToken(token));
    const result = await consumeVerificationToken(harness.db, token);

    // Distinct reason so the UI can offer "send a new link" rather than a dead end.
    expect(result).toEqual({ ok: false, reason: "expired" });
    // Deleted regardless, so a stale link cannot be retried indefinitely.
    expect(harness.rows()).toHaveLength(0);
  });

  it("retires an earlier token when a new one is issued", async () => {
    harness.setFilter((r) => r.identifier === verificationIdentifier("a@example.com"));

    await issueVerificationToken(harness.db, "a@example.com");
    const second = await issueVerificationToken(harness.db, "a@example.com");

    // Exactly one live token per address: an intercepted first link stops working
    // as soon as the user asks for another.
    expect(harness.rows()).toHaveLength(1);
    expect(harness.rows()[0]?.token).toBe(hashVerificationToken(second));
  });

  it("refuses a row whose identifier is not an email-verification one", async () => {
    // The same table is NextAuth's. A token from another purpose must not be
    // redeemable as proof of an email address.
    harness.setFilter(() => true);
    const token = generateVerificationToken();
    harness.rows().push({
      identifier: "some-other-purpose:a@example.com",
      token: hashVerificationToken(token),
      expires: new Date(Date.now() + 1000),
    });

    expect(await consumeVerificationToken(harness.db, token)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
