/**
 * Two-step sign-in by email.
 *
 * With `users.twoFactorEnabled` on, a correct password does not produce a
 * session. It produces a *challenge*, and one email that carries two ways to
 * answer it:
 *
 *   - an eight-digit code, typed into the browser that is signing in, or
 *   - a link, which opens a page with an Approve button. Pressing it marks the
 *     challenge approved, and the browser that is signing in (which polls
 *     `auth.twoFactorStatus`) finishes on its own.
 *
 * Either way the session is only ever created in the browser that proved the
 * password, because only that browser holds the challenge *secret* and the
 * `two-factor` provider in `config.ts` will not sign anyone in without it. The
 * link is an approval, not a login link: opening it on a phone approves the
 * laptop, and a forwarded or intercepted link is worth nothing without the
 * password that started the challenge.
 *
 * ## Why the link needs a button
 *
 * Mail scanners (Outlook Safe Links, corporate gateways) fetch every link in an
 * incoming message, and some run its JavaScript. A link that approved on load
 * would be approved by the scanner before the person had read the email. The
 * page therefore does nothing until someone presses Approve — a POST no
 * scanner sends.
 *
 * ## Storage
 *
 * Only SHA-256 digests are kept, as in `~/server/email/verificationCodes`: a
 * read of the table must not yield anything that answers a challenge. The
 * code is defended by the ten-minute window and the five-attempt cap on the
 * row; the secret and the link token carry 256 bits each and need neither.
 */

import "server-only";

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { twoFactorChallenges } from "~/server/db/schema";

type Db = typeof Database;

/**
 * How long a sign-in challenge stays answerable.
 *
 * Shorter than the fifteen minutes a reset code gets: the person is sitting at
 * the sign-in screen right now, and a sign-in approval that is still live an
 * hour later is one somebody else can use.
 */
export const TWO_FACTOR_TTL_MS = 10 * 60 * 1000;

/** Wrong codes one challenge tolerates before it is burned. */
export const MAX_TWO_FACTOR_ATTEMPTS = 5;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export type IssuedChallenge = {
  /** Handed to the browser that proved the password. Never emailed. */
  secret: string;
  /** Emailed. */
  code: string;
  /** Emailed, inside the approval link. */
  linkToken: string;
  expiresAt: Date;
};

/**
 * Open a challenge for a user whose password was just verified, retiring any
 * challenge they already had.
 *
 * Returns the plaintext secrets — the only moment they exist.
 */
export async function issueTwoFactorChallenge(
  db: Db,
  userId: string,
): Promise<IssuedChallenge> {
  const secret = randomBytes(32).toString("base64url");
  const linkToken = randomBytes(32).toString("base64url");
  // Eight digits, matching the boxes the sign-in modal renders and the other
  // emailed codes. `randomInt` avoids the modulo bias.
  const code = String(randomInt(10_000_000, 100_000_000));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TWO_FACTOR_TTL_MS);

  // One live challenge per user. Otherwise every "send a new code" leaves the
  // previous email's code and link working for the rest of their window.
  await db
    .update(twoFactorChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(twoFactorChallenges.userId, userId),
        isNull(twoFactorChallenges.consumedAt),
      ),
    );

  await db.insert(twoFactorChallenges).values({
    userId,
    secretHash: sha256(secret),
    codeHash: sha256(code),
    linkTokenHash: sha256(linkToken),
    expiresAt,
  });

  return { secret, code, linkToken, expiresAt };
}

export type ChallengeStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "invalid";

type ChallengeRow = typeof twoFactorChallenges.$inferSelect;

function statusOf(row: ChallengeRow | undefined, now = Date.now()): ChallengeStatus {
  if (!row) return "invalid";
  if (row.deniedAt) return "denied";
  if (row.consumedAt) return "invalid";
  if (row.expiresAt.getTime() < now) return "expired";
  if (row.approvedAt) return "approved";
  return "pending";
}

async function findBySecret(db: Db, secret: string) {
  if (!secret) return undefined;
  return db.query.twoFactorChallenges.findFirst({
    where: eq(twoFactorChallenges.secretHash, sha256(secret)),
  });
}

async function findByLinkToken(db: Db, token: string) {
  if (!token) return undefined;
  return db.query.twoFactorChallenges.findFirst({
    where: eq(twoFactorChallenges.linkTokenHash, sha256(token)),
  });
}

/** What the waiting browser polls. Read-only. */
export async function getTwoFactorStatus(
  db: Db,
  secret: string,
): Promise<ChallengeStatus> {
  return statusOf(await findBySecret(db, secret));
}

/** What the approval page shows before anyone presses a button. Read-only. */
export async function reviewTwoFactorLink(
  db: Db,
  token: string,
): Promise<{ status: ChallengeStatus; requestedAt: Date | null }> {
  const row = await findByLinkToken(db, token);
  return { status: statusOf(row), requestedAt: row?.createdAt ?? null };
}

/**
 * Approve or refuse a sign-in from the emailed link.
 *
 * Refusing burns the challenge, so the waiting browser is told and a code from
 * the same email stops working too. Deciding a second time is a no-op that
 * reports the state already reached.
 */
export async function decideTwoFactorLink(
  db: Db,
  token: string,
  decision: "approve" | "deny",
): Promise<ChallengeStatus> {
  const row = await findByLinkToken(db, token);
  const status = statusOf(row);
  if (!row || status !== "pending") return status;

  const now = new Date();
  await db
    .update(twoFactorChallenges)
    .set(
      decision === "approve"
        ? { approvedAt: now }
        : { deniedAt: now, consumedAt: now },
    )
    .where(
      and(
        eq(twoFactorChallenges.id, row.id),
        isNull(twoFactorChallenges.consumedAt),
      ),
    );

  return decision === "approve" ? "approved" : "denied";
}

export type RedeemResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: "invalid" | "expired" | "denied" | "not_approved" | "too_many_attempts";
    };

/**
 * Finish a sign-in: the browser presents its secret, plus either the emailed
 * code or nothing (meaning "the link was approved").
 *
 * Spends the challenge on success. The spend is a conditional update, so two
 * requests racing with the same secret cannot both come away with a session.
 */
export async function redeemTwoFactorChallenge(
  db: Db,
  secret: string,
  code: string | null,
): Promise<RedeemResult> {
  const row = await findBySecret(db, secret);
  const status = statusOf(row);

  if (!row || status === "invalid") return { ok: false, reason: "invalid" };
  if (status === "denied") return { ok: false, reason: "denied" };
  if (status === "expired") return { ok: false, reason: "expired" };

  if (code !== null) {
    if (row.attempts >= MAX_TWO_FACTOR_ATTEMPTS) {
      return { ok: false, reason: "too_many_attempts" };
    }

    if (!hashesMatch(row.codeHash, sha256(code))) {
      const attempts = row.attempts + 1;
      const burned = attempts >= MAX_TWO_FACTOR_ATTEMPTS;
      await db
        .update(twoFactorChallenges)
        .set({ attempts, consumedAt: burned ? new Date() : null })
        .where(eq(twoFactorChallenges.id, row.id));
      return { ok: false, reason: burned ? "too_many_attempts" : "invalid" };
    }
  } else if (status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }

  const [spent] = await db
    .update(twoFactorChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(twoFactorChallenges.id, row.id),
        isNull(twoFactorChallenges.consumedAt),
      ),
    )
    .returning({ userId: twoFactorChallenges.userId });

  if (!spent) return { ok: false, reason: "invalid" };
  return { ok: true, userId: spent.userId };
}
