/**
 * Short numeric codes emailed to prove control of an address.
 *
 * The link-token flow in `emailVerification.ts` is the other half of this: a
 * link is the right shape for "you just signed up, click here", and a code is
 * the right shape for "you are already looking at the screen that asked for
 * it". Password reset has always used a code; profile verification from the
 * settings screen now does too, because the user is sitting in front of the
 * app and bouncing them out to a mail client and back loses the session context
 * the screen already has.
 *
 * ## Only the hash is stored
 *
 * `password_reset_code` kept the digits in plaintext, which made every backup
 * and every stray query result a live credential for anyone with an outstanding
 * reset. This module stores a SHA-256 and nothing else — the same standard
 * `emailVerification.ts` already held link tokens to, and the "separate
 * outstanding item" its header referred to.
 *
 * SHA-256 rather than argon2 deliberately. Argon2 is what you want for a secret
 * that lives for years and must survive an offline attack; an eight-digit code
 * has ~27 bits of entropy and would fall to a GPU regardless of the KDF. What
 * actually defends it is the fifteen-minute window, the five-attempt cap on the
 * row, and the rate limiter — and a fast hash keeps verification cheap enough
 * that the attempt counter is the binding constraint rather than CPU.
 */

import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { verificationCodes } from "~/server/db/schema";

type Db = typeof Database;

export type VerificationPurpose = "email_verify" | "password_reset";

/** How long an emailed code stays usable. */
export const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * How many wrong guesses one issued code tolerates before it is burned.
 *
 * The rate limiter is keyed on address and IP, which a patient attacker spreads
 * around; this counter is keyed on the code itself, which they cannot.
 */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Eight digits, matching the boxes the sign-in modal renders.
 *
 * `randomInt` rather than `randomBytes(4) % 90000000 + 10000000` — the modulo
 * form the reset flow used is biased, and while the bias is small it costs
 * nothing to avoid it in a security primitive.
 */
export function generateVerificationCode(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

export function hashVerificationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Constant-time comparison of two fixed-length hex digests. */
function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Issue a code, retiring every earlier one for the same address and purpose.
 *
 * Returns the plaintext — the only moment it exists — for the caller to put in
 * an email. It is never returned to a client.
 */
export async function issueVerificationCode(
  db: Db,
  purpose: VerificationPurpose,
  rawEmail: string,
): Promise<string> {
  const email = normalizeEmail(rawEmail);
  const code = generateVerificationCode();

  // One live code per (address, purpose). Without this, each request left the
  // previous code valid, so a window that was meant to hold one code held five
  // — including after the password had already been changed.
  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(verificationCodes.email, email),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
      ),
    );

  await db.insert(verificationCodes).values({
    purpose,
    email,
    codeHash: hashVerificationCode(code),
    expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS),
  });

  return code;
}

export type CodeCheckResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

/**
 * Check a code without spending it.
 *
 * Split from `consume` because the reset flow verifies the code on one screen
 * and sets the new password on the next, and a code spent on the first screen
 * would strand the user between them. A failed check still costs an attempt —
 * that is the whole point of the counter.
 */
export async function checkVerificationCode(
  db: Db,
  purpose: VerificationPurpose,
  rawEmail: string,
  code: string,
): Promise<CodeCheckResult> {
  const email = normalizeEmail(rawEmail);

  const [row] = await db
    .select()
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.email, email),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
      ),
    )
    .orderBy(desc(verificationCodes.id))
    .limit(1);

  if (!row) return { ok: false, reason: "invalid" };

  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .update(verificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(verificationCodes.id, row.id));
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!hashesMatch(row.codeHash, hashVerificationCode(code))) {
    const attempts = row.attempts + 1;
    await db
      .update(verificationCodes)
      .set({
        attempts,
        // Burn the code outright on the last allowed miss, so a subsequent
        // correct guess cannot land after the budget is spent.
        consumedAt: attempts >= MAX_CODE_ATTEMPTS ? new Date() : null,
      })
      .where(eq(verificationCodes.id, row.id));

    return {
      ok: false,
      reason: attempts >= MAX_CODE_ATTEMPTS ? "too_many_attempts" : "invalid",
    };
  }

  return { ok: true };
}

/**
 * Check a code and spend it in the same step.
 *
 * Use this wherever the code authorises the action being taken right now.
 */
export async function consumeVerificationCode(
  db: Db,
  purpose: VerificationPurpose,
  rawEmail: string,
  code: string,
): Promise<CodeCheckResult> {
  const result = await checkVerificationCode(db, purpose, rawEmail, code);
  if (!result.ok) return result;

  const email = normalizeEmail(rawEmail);

  // Retire every outstanding code for the address, not only the one redeemed.
  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(verificationCodes.email, email),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
      ),
    );

  return { ok: true };
}
