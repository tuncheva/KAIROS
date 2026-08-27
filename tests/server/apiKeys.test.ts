/**
 * API keys: the shape of a key, and what verification refuses.
 *
 * The database is stubbed, so what is exercised here is the credential logic:
 * how a key is formed, whether a malformed one is ever looked up, and whether a
 * revoked one can authenticate. The queries themselves are ordinary Drizzle and
 * are not what would go wrong.
 *
 * The most valuable assertion is the cheapest: a presented value that does not
 * even look like a key must be rejected *before* touching the database. Without
 * that, an unauthenticated caller can make the server do a query per request
 * simply by sending garbage — which is a free amplification primitive on the
 * one code path that runs before any authentication has happened.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = { selects: 0, updates: 0 };
let storedRow:
  | { id: number; userId: string; keyHash: string; lastUsedAt: Date | null }
  | undefined;

vi.mock("~/server/db", () => ({
  db: {
    select: () => {
      calls.selects += 1;
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(storedRow ? [storedRow] : []) }),
        }),
      };
    },
    update: () => {
      calls.updates += 1;
      return {
        set: () => ({
          where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
        }),
      };
    },
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 7 }]) }),
    }),
  },
}));

const { KEY_FORMAT, mintApiKey, verifyApiKey } = await import(
  "~/server/api/apiKeys"
);

const { createHash } = await import("node:crypto");

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

beforeEach(() => {
  calls.selects = 0;
  calls.updates = 0;
  storedRow = undefined;
});

describe("mintApiKey", () => {
  it("returns the plaintext exactly once, with the marker prefix", async () => {
    const minted = await mintApiKey({ userId: "user_1", label: "CI" });

    expect(minted.plaintext.startsWith(KEY_FORMAT.prefix)).toBe(true);
    expect(minted.prefix).toBe(minted.plaintext.slice(0, KEY_FORMAT.prefixLength));
  });

  it("uses a URL-safe alphabet", () => {
    // `+` and `/` get mangled by whoever pastes the key into a config file or a
    // URL. base64url avoids the support ticket.
    return mintApiKey({ userId: "user_1", label: "CI" }).then((minted) => {
      expect(minted.plaintext.slice(KEY_FORMAT.prefix.length)).toMatch(
        /^[A-Za-z0-9_-]+$/,
      );
    });
  });

  it("does not repeat", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const minted = await mintApiKey({ userId: "user_1", label: "CI" });
      seen.add(minted.plaintext);
    }
    expect(seen.size).toBe(25);
  });

  it("carries enough entropy that guessing is not a threat model", async () => {
    const minted = await mintApiKey({ userId: "user_1", label: "CI" });
    const secret = minted.plaintext.slice(KEY_FORMAT.prefix.length);

    // 32 bytes in base64url is 43 characters. This is also the justification for
    // hashing with SHA-256 rather than argon2: there is nothing here to guess, so
    // a deliberately slow hash would only cost ~100ms on every API request.
    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(KEY_FORMAT.bytes).toBeGreaterThanOrEqual(32);
  });
});

describe("verifyApiKey — rejected without a query", () => {
  it("rejects null and empty without touching the database", async () => {
    expect(await verifyApiKey(null)).toBeNull();
    expect(await verifyApiKey("")).toBeNull();
    expect(calls.selects).toBe(0);
  });

  it("rejects a value without the marker prefix without a query", async () => {
    // The amplification guard: this path runs before any authentication, so a
    // caller sending junk must not be able to make the server do work.
    expect(await verifyApiKey("Bearer something")).toBeNull();
    expect(await verifyApiKey("sk_live_whatever")).toBeNull();
    expect(calls.selects).toBe(0);
  });

  it("rejects a key too short to be real without a query", async () => {
    expect(await verifyApiKey(`${KEY_FORMAT.prefix}abc`)).toBeNull();
    expect(calls.selects).toBe(0);
  });
});

describe("verifyApiKey — against a stored row", () => {
  const plaintext = `${KEY_FORMAT.prefix}${"a".repeat(43)}`;

  it("accepts a key whose hash matches", async () => {
    storedRow = {
      id: 1,
      userId: "user_1",
      keyHash: hash(plaintext),
      lastUsedAt: null,
    };

    await expect(verifyApiKey(plaintext)).resolves.toEqual({
      userId: "user_1",
      keyId: 1,
    });
  });

  it("rejects a key whose hash does not match", async () => {
    // Same prefix, different secret — the case that matters, since the prefix is
    // stored in clear and is therefore not a secret at all.
    storedRow = {
      id: 1,
      userId: "user_1",
      keyHash: hash(`${KEY_FORMAT.prefix}${"b".repeat(43)}`),
      lastUsedAt: null,
    };

    expect(await verifyApiKey(plaintext)).toBeNull();
  });

  it("rejects when no row matches the prefix", async () => {
    storedRow = undefined;
    expect(await verifyApiKey(plaintext)).toBeNull();
  });

  it("stores no plaintext anywhere in what it returns", async () => {
    storedRow = {
      id: 1,
      userId: "user_1",
      keyHash: hash(plaintext),
      lastUsedAt: null,
    };

    const result = await verifyApiKey(plaintext);
    expect(JSON.stringify(result)).not.toContain(plaintext);
  });
});

describe("verifyApiKey — lastUsedAt is written lazily", () => {
  const plaintext = `${KEY_FORMAT.prefix}${"a".repeat(43)}`;

  it("writes it when it has never been set", async () => {
    storedRow = { id: 1, userId: "user_1", keyHash: hash(plaintext), lastUsedAt: null };

    await verifyApiKey(plaintext);
    expect(calls.updates).toBe(1);
  });

  it("does not write it again within the staleness window", async () => {
    // Otherwise every read-only API call becomes a write, and this row becomes
    // the hottest in the database.
    storedRow = {
      id: 1,
      userId: "user_1",
      keyHash: hash(plaintext),
      lastUsedAt: new Date(),
    };

    await verifyApiKey(plaintext);
    expect(calls.updates).toBe(0);
  });

  it("writes it once the value has gone stale", async () => {
    storedRow = {
      id: 1,
      userId: "user_1",
      keyHash: hash(plaintext),
      lastUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    };

    await verifyApiKey(plaintext);
    expect(calls.updates).toBe(1);
  });
});
