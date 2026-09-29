import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";

import {
  MAX_TWO_FACTOR_ATTEMPTS,
  TWO_FACTOR_TTL_MS,
  decideTwoFactorLink,
  getTwoFactorStatus,
  issueTwoFactorChallenge,
  redeemTwoFactorChallenge,
  reviewTwoFactorLink,
} from "~/server/auth/twoFactor";
import { renderTwoFactorSignInForTest } from "~/server/email/email";
import type { db as Database } from "~/server/db";

/**
 * Behavioural tests for two-step sign-in challenges.
 *
 * `users.twoFactorEnabled` existed for months with nothing reading it. These
 * pin the state machine that now stands behind it: which secret can do what,
 * that every path is single-use, and that the attempt cap holds.
 *
 * The database is an in-memory stand-in. Unlike the stubs in
 * `emailVerification.test.ts` it reads the bound values out of Drizzle's SQL
 * objects, so a `where` on the wrong column really does match nothing — and it
 * honours `IS NULL`, which is what makes the single-use spend worth testing.
 */

type Row = {
  id: number;
  userId: string;
  secretHash: string;
  codeHash: string;
  linkTokenHash: string;
  attempts: number;
  expiresAt: Date;
  approvedAt: Date | null;
  deniedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
};

/** Walk a Drizzle SQL object, collecting bound params (with their column) and literal fragments. */
function inspect(where: unknown) {
  const params: { column: string | undefined; value: unknown }[] = [];
  const text: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const name = (node as { constructor?: { name?: string } }).constructor?.name;
    if (name === "Param") {
      const param = node as { value: unknown; encoder?: { name?: string } };
      params.push({ column: param.encoder?.name, value: param.value });
      return;
    }
    if (name === "StringChunk") {
      text.push(...((node as { value: string[] }).value ?? []));
      return;
    }
    // Columns and tables point back at the whole schema; the predicate's own
    // chunks are all that matter.
    if (name?.startsWith("Pg")) return;
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) chunks.forEach(walk);
  };
  walk(where);
  return { params, requiresUnconsumed: text.join("").includes("is null") };
}

function fakeDb() {
  const rows: Row[] = [];
  let nextId = 1;

  const matches = (r: Row, where: unknown) => {
    const { params, requiresUnconsumed } = inspect(where);
    if (requiresUnconsumed && r.consumedAt) return false;
    const byColumn: Record<string, unknown> = {
      id: r.id,
      user_id: r.userId,
      secret_hash: r.secretHash,
      link_token_hash: r.linkTokenHash,
    };
    return (
      params.length > 0 &&
      params.every((p) => p.column !== undefined && byColumn[p.column] === p.value)
    );
  };

  const db = {
    query: {
      twoFactorChallenges: {
        findFirst: ({ where }: { where: unknown }) =>
          Promise.resolve(rows.find((r) => matches(r, where))),
      },
    },
    insert: () => ({
      values: (v: Partial<Row>) => {
        rows.push({
          id: nextId++,
          attempts: 0,
          approvedAt: null,
          deniedAt: null,
          consumedAt: null,
          createdAt: new Date(),
          ...v,
        } as Row);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (where: unknown) => {
          const hit = rows.filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, patch));
          const done = Promise.resolve(hit);
          return Object.assign(done, {
            returning: () =>
              Promise.resolve(hit.map((r) => ({ userId: r.userId }))),
          });
        },
      }),
    }),
  };

  return { db: db as unknown as typeof Database, rows: () => rows };
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

let store: ReturnType<typeof fakeDb>;

beforeEach(() => {
  store = fakeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issuing", () => {
  it("returns three distinct secrets and stores only their hashes", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");

    expect(c.code).toMatch(/^\d{8}$/);
    expect(c.secret).not.toBe(c.linkToken);
    expect(c.secret.length).toBeGreaterThanOrEqual(40);

    const [row] = store.rows();
    expect(row!.secretHash).toBe(sha256(c.secret));
    expect(row!.codeHash).toBe(sha256(c.code));
    expect(row!.linkTokenHash).toBe(sha256(c.linkToken));
    expect(JSON.stringify(row)).not.toContain(c.code);
    expect(JSON.stringify(row)).not.toContain(c.secret);
  });

  it("retires the previous challenge, so an older email stops working", async () => {
    const first = await issueTwoFactorChallenge(store.db, "u1");
    await issueTwoFactorChallenge(store.db, "u1");

    expect(await getTwoFactorStatus(store.db, first.secret)).toBe("invalid");
    expect(await redeemTwoFactorChallenge(store.db, first.secret, first.code)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("does not touch another user's challenge", async () => {
    const other = await issueTwoFactorChallenge(store.db, "u2");
    await issueTwoFactorChallenge(store.db, "u1");

    expect(await getTwoFactorStatus(store.db, other.secret)).toBe("pending");
  });
});

describe("finishing with the code", () => {
  it("signs in once, and only once", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");

    expect(await redeemTwoFactorChallenge(store.db, c.secret, c.code)).toEqual({
      ok: true,
      userId: "u1",
    });
    expect(await redeemTwoFactorChallenge(store.db, c.secret, c.code)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("burns the challenge after the last allowed wrong code", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");
    const wrong = c.code === "11111111" ? "22222222" : "11111111";

    for (let i = 1; i < MAX_TWO_FACTOR_ATTEMPTS; i++) {
      expect(await redeemTwoFactorChallenge(store.db, c.secret, wrong)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect(await redeemTwoFactorChallenge(store.db, c.secret, wrong)).toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
    // The right code is no good after the budget is spent.
    expect((await redeemTwoFactorChallenge(store.db, c.secret, c.code)).ok).toBe(false);
  });

  it("needs the browser's secret — the code alone opens nothing", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");

    expect(await redeemTwoFactorChallenge(store.db, c.linkToken, c.code)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses once the window has passed", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TWO_FACTOR_TTL_MS + 1000);

    expect(await redeemTwoFactorChallenge(store.db, c.secret, c.code)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("finishing with the link", () => {
  it("does nothing until someone presses Approve", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");

    // Opening the page is a read. A mail scanner can do this all day.
    expect((await reviewTwoFactorLink(store.db, c.linkToken)).status).toBe("pending");
    expect(await redeemTwoFactorChallenge(store.db, c.secret, null)).toEqual({
      ok: false,
      reason: "not_approved",
    });
  });

  it("unlocks the waiting browser after approval, once", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");

    expect(await decideTwoFactorLink(store.db, c.linkToken, "approve")).toBe("approved");
    expect(await getTwoFactorStatus(store.db, c.secret)).toBe("approved");
    expect(await redeemTwoFactorChallenge(store.db, c.secret, null)).toEqual({
      ok: true,
      userId: "u1",
    });
    expect((await redeemTwoFactorChallenge(store.db, c.secret, null)).ok).toBe(false);
  });

  it("is an approval, not a login: the link token cannot finish a sign-in", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");
    await decideTwoFactorLink(store.db, c.linkToken, "approve");

    expect((await redeemTwoFactorChallenge(store.db, c.linkToken, null)).ok).toBe(false);
  });

  it("refusing tells the waiting browser and kills the code too", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");

    expect(await decideTwoFactorLink(store.db, c.linkToken, "deny")).toBe("denied");
    expect(await getTwoFactorStatus(store.db, c.secret)).toBe("denied");
    expect(await redeemTwoFactorChallenge(store.db, c.secret, c.code)).toEqual({
      ok: false,
      reason: "denied",
    });
  });

  it("cannot be flipped once decided", async () => {
    const c = await issueTwoFactorChallenge(store.db, "u1");
    await decideTwoFactorLink(store.db, c.linkToken, "deny");

    expect(await decideTwoFactorLink(store.db, c.linkToken, "approve")).toBe("denied");
    expect(await getTwoFactorStatus(store.db, c.secret)).toBe("denied");
  });

  it("reports an unknown token as invalid", async () => {
    expect(await decideTwoFactorLink(store.db, "nope", "approve")).toBe("invalid");
  });
});

describe("the email", () => {
  it("carries the code and the approval link, and escapes the name", () => {
    const html = renderTwoFactorSignInForTest({
      userName: "<img src=x onerror=alert(1)>",
      code: "12345678",
      approveUrl: "https://app.example/verify-login?token=abc&x=1",
    });

    expect(html).toContain("12345678");
    expect(html).toContain("https://app.example/verify-login?token=abc&amp;x=1");
    expect(html).not.toContain("<img src=x");
  });
});
