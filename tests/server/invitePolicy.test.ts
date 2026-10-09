/**
 * The invitation-email rules that do not need a database: the opt-out token,
 * the suppression hash and the resend cap. See `~/server/orgs/invitePolicy`.
 */

import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("~/env", () => ({
  env: { AUTH_SECRET: "x".repeat(40), REDIS_NATIVE_URL: undefined },
}));
// The module imports the db only for types and the purge; nothing here queries.
vi.mock("~/server/db", () => ({ db: {} }));

import {
  assertCanResend,
  optOutToken,
  suppressionHash,
  verifyOptOutToken,
} from "~/server/orgs/invitePolicy";

const DAY = 24 * 60 * 60 * 1000;

describe("suppression hash", () => {
  it("is the same for any spelling of one address, and never contains it", () => {
    const hash = suppressionHash("Ana@Example.com ");
    expect(hash).toBe(suppressionHash("ana@example.com"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("ana");
  });
});

describe("opt-out token", () => {
  it("round-trips to the address's suppression hash", () => {
    const token = optOutToken("ana@example.com");
    expect(verifyOptOutToken(token)).toBe(suppressionHash("ana@example.com"));
  });

  it("does not carry the address", () => {
    expect(optOutToken("ana@example.com")).not.toContain("ana");
  });

  it("rejects a forged or altered token", () => {
    const token = optOutToken("ana@example.com");
    const [hash] = token.split(".");
    // Someone else's hash with Ana's signature — the obvious forgery.
    const other = suppressionHash("bob@example.com");
    expect(verifyOptOutToken(`${other}.${token.split(".")[1]}`)).toBeNull();
    expect(verifyOptOutToken(`${hash}.${"0".repeat(32)}`)).toBeNull();
    expect(verifyOptOutToken("not-a-token")).toBeNull();
  });
});

describe("resend cap", () => {
  const now = Date.UTC(2026, 9, 8, 12);
  const sent = (daysAgo: number) => new Date(now - daysAgo * DAY);

  it("allows a resend a day after the last send", () => {
    expect(() =>
      assertCanResend({ sendCount: 1, lastSentAt: sent(1), createdAt: sent(1) }, now),
    ).not.toThrow();
  });

  it("refuses a second email within a day", () => {
    expect(() =>
      assertCanResend({ sendCount: 1, lastSentAt: sent(0.5), createdAt: sent(0.5) }, now),
    ).toThrow(TRPCError);
  });

  it("refuses a third resend however long ago the last was", () => {
    expect(() =>
      assertCanResend({ sendCount: 3, lastSentAt: sent(5), createdAt: sent(9) }, now),
    ).toThrow(/resent twice/);
  });
});
