import { describe, it, expect } from "vitest";

import {
  ACCOUNT_SWITCH_ENTRY_TTL_MS,
  decodeAccountSwitchCookie,
  encodeAccountSwitchCookie,
  getCookieFromHeader,
  type AccountSwitchEntry,
} from "~/server/security/accountSwitch";

/**
 * Behavioural tests for the account-switch cookie.
 *
 * The cookie establishes *which* accounts a browser may be offered. It is not
 * authorization to enter one — the provider additionally requires that account's
 * password (see the `account-switch` provider in `~/server/auth/config`). These
 * tests cover the part that lives in pure functions: signing, and the per-entry
 * expiry that replaced relying on the cookie's `maxAge` alone.
 */

const SECRET = "test-secret-at-least-32-characters-long!!";
const NOW = 1_700_000_000_000;

function entry(overrides: Partial<AccountSwitchEntry> = {}): AccountSwitchEntry {
  return {
    userId: "user-1",
    email: "a@example.com",
    name: "A",
    image: null,
    lastUsed: NOW,
    expiresAt: NOW + ACCOUNT_SWITCH_ENTRY_TTL_MS,
    ...overrides,
  };
}

describe("account-switch cookie signing", () => {
  it("round-trips a valid entry", () => {
    const value = encodeAccountSwitchCookie([entry()], SECRET);
    const decoded = decodeAccountSwitchCookie(value, SECRET, NOW);

    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.userId).toBe("user-1");
  });

  it("rejects a payload signed with a different secret", () => {
    const value = encodeAccountSwitchCookie([entry()], "another-secret-that-is-long-enough!!");
    expect(decodeAccountSwitchCookie(value, SECRET, NOW)).toEqual([]);
  });

  it("rejects a tampered payload", () => {
    const value = encodeAccountSwitchCookie([entry()], SECRET);
    const [payload, sig] = value.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, accounts: [entry({ userId: "attacker" })] }),
      "utf8",
    ).toString("base64url");

    expect(payload).not.toBe(forged);
    expect(decodeAccountSwitchCookie(`${forged}.${sig}`, SECRET, NOW)).toEqual([]);
  });

  it("rejects a malformed value without throwing", () => {
    for (const value of ["", "no-dot", "a.b", "...."]) {
      expect(decodeAccountSwitchCookie(value, SECRET, NOW)).toEqual([]);
    }
  });
});

describe("per-entry expiry", () => {
  it("keeps an entry that has not expired", () => {
    const value = encodeAccountSwitchCookie([entry()], SECRET);
    expect(decodeAccountSwitchCookie(value, SECRET, NOW + 1000)).toHaveLength(1);
  });

  it("drops an entry past its deadline even though the signature is valid", () => {
    // The cookie's own maxAge is not a boundary the server controls — a copied
    // cookie jar keeps presenting it. The deadline inside the signed payload is.
    const value = encodeAccountSwitchCookie([entry()], SECRET);
    const after = NOW + ACCOUNT_SWITCH_ENTRY_TTL_MS + 1;

    expect(decodeAccountSwitchCookie(value, SECRET, after)).toEqual([]);
  });

  it("drops legacy entries that carry no deadline at all", () => {
    // Fails closed: cookies written before expiry existed cost their owner one
    // extra sign-in rather than remaining switchable forever.
    const legacy = { ...entry() };
    delete (legacy as { expiresAt?: number }).expiresAt;

    const value = encodeAccountSwitchCookie([legacy], SECRET);
    expect(decodeAccountSwitchCookie(value, SECRET, NOW)).toEqual([]);
  });

  it("expires entries independently of each other", () => {
    const fresh = entry({ userId: "fresh", email: "f@example.com" });
    const stale = entry({
      userId: "stale",
      email: "s@example.com",
      expiresAt: NOW - 1,
    });

    const value = encodeAccountSwitchCookie([fresh, stale], SECRET);
    const decoded = decodeAccountSwitchCookie(value, SECRET, NOW);

    expect(decoded.map((a) => a.userId)).toEqual(["fresh"]);
  });
});

describe("getCookieFromHeader", () => {
  it("finds the named cookie among others", () => {
    expect(getCookieFromHeader("a=1; kairos.accounts=xyz; b=2", "kairos.accounts")).toBe("xyz");
  });

  it("returns undefined when absent or when there is no header", () => {
    expect(getCookieFromHeader("a=1", "kairos.accounts")).toBeUndefined();
    expect(getCookieFromHeader(null, "kairos.accounts")).toBeUndefined();
  });

  it("preserves base64 values containing '='", () => {
    expect(getCookieFromHeader("k=aGk=", "k")).toBe("aGk=");
  });
});
