/**
 * Email-verification tokens.
 *
 * Before this existed, `auth.signup` stamped `emailVerified: new Date()` without
 * sending anything, so the column was decoration. Combined with OAuth account
 * linking that was an account-takeover path: register `victim@company.com` with a
 * password you choose, wait for the real owner to sign in with Google, and the
 * provider identity attaches to *your* row — your password now opens their
 * account. That is the documented reason the NextAuth option is named
 * "allowDangerousEmailAccountLinking".
 *
 * ## Storage
 *
 * Tokens live in the `verification_token` table, which the NextAuth Drizzle
 * adapter defines and which nothing used under the JWT session strategy. Its
 * shape — `(identifier, token, expires)` keyed on `(identifier, token)` — is
 * exactly right here: identifier is the email, so a user can hold several
 * outstanding tokens and redeeming any one of them works.
 *
 * ## Only the hash is stored
 *
 * The row holds a SHA-256 of the token, never the token itself. A read of the
 * database — a backup, a log, an injection — must not yield anything that can be
 * replayed against this endpoint. The same reason password reset codes should be
 * hashed, which is a separate outstanding item.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { verificationTokens } from "~/server/db/schema";

/** How long a verification link stays usable. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Prefix on the stored identifier.
 *
 * The same table is the adapter's, so namespacing keeps our rows from colliding
 * with anything NextAuth writes if a database session strategy is ever adopted.
 */
const IDENTIFIER_PREFIX = "email-verify:";

export function verificationIdentifier(email: string): string {
  return `${IDENTIFIER_PREFIX}${email.trim().toLowerCase()}`;
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A URL-safe token with 256 bits of entropy. */
export function generateVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time comparison of two token hashes.
 *
 * Both are fixed-length hex from SHA-256, so a length mismatch means one is
 * malformed rather than merely different.
 */
export function verificationHashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

type Db = typeof Database;

/**
 * Issue a token for an address, retiring any it already had.
 *
 * Returns the plaintext token — the only moment it exists — for the caller to
 * put in an email. It is never returned to a client.
 */
export async function issueVerificationToken(
  db: Db,
  email: string,
): Promise<string> {
  const identifier = verificationIdentifier(email);
  const token = generateVerificationToken();

  // One live token per address: a new request invalidates the previous link, so a
  // token captured earlier stops working once the user asks for another.
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));

  await db.insert(verificationTokens).values({
    identifier,
    token: hashVerificationToken(token),
    expires: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  });

  return token;
}

export type VerificationResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Consume a token, returning the address it proves.
 *
 * The token is single-use: the row is deleted on success. An expired row is also
 * deleted, so a stale link cannot be retried indefinitely.
 */
export async function consumeVerificationToken(
  db: Db,
  token: string,
): Promise<VerificationResult> {
  if (!token) return { ok: false, reason: "invalid" };

  const tokenHash = hashVerificationToken(token);

  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(eq(verificationTokens.token, tokenHash))
    .limit(1);

  if (!row || !verificationHashesMatch(row.token, tokenHash)) {
    return { ok: false, reason: "invalid" };
  }

  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, row.identifier),
        eq(verificationTokens.token, row.token),
      ),
    );

  if (row.expires.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (!row.identifier.startsWith(IDENTIFIER_PREFIX)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, email: row.identifier.slice(IDENTIFIER_PREFIX.length) };
}

/** Housekeeping: drop rows whose deadline has passed. */
export async function pruneExpiredVerificationTokens(db: Db): Promise<void> {
  await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expires, new Date()));
}
