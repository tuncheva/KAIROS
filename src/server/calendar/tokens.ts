/**
 * Encryption for calendar tokens at rest.
 *
 * A calendar refresh token is a long-lived credential to read someone's entire
 * schedule. `accounts` stores sign-in tokens in clear because NextAuth owns that
 * table's shape; these are ours, so there is no reason for them to be legible in
 * a database dump or a support query.
 *
 * The key is derived from `AUTH_SECRET` — already the application's root secret,
 * already required to be at least 32 characters — with a **per-connection salt**,
 * so recovering one row's plaintext gives no advantage against any other. The
 * salt is stored beside the ciphertext, which is what salts are for: it is not
 * secret, it is unique.
 *
 * On cost: `encryptContent` derives with 210,000 PBKDF2 iterations, which is
 * sized for guarding a *user-chosen password* and is heavier than a server-held
 * secret strictly needs. Kept anyway, because a token is decrypted at most once
 * per refresh — roughly hourly per connected user — and reusing the codebase's
 * one reviewed crypto path is worth more than the milliseconds.
 */

import "server-only";

import crypto from "node:crypto";

import { env } from "~/env";
import { decryptContent, encryptContent } from "~/server/security/encryption";

/** A fresh salt for a new connection. */
export function newTokenSalt(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function encryptToken(plaintext: string, salt: string): string {
  return encryptContent(plaintext, env.AUTH_SECRET, salt);
}

/**
 * Decrypt a stored token.
 *
 * Returns null rather than throwing on failure. A token that cannot be decrypted
 * — because `AUTH_SECRET` was rotated, or the row was written by a different
 * deployment — is indistinguishable from no token at all, and the correct
 * response either way is to ask the user to reconnect. Throwing would take down
 * a sync sweep over a row that is simply unusable.
 */
export function decryptToken(cipher: string, salt: string): string | null {
  try {
    return decryptContent(cipher, env.AUTH_SECRET, salt);
  } catch {
    return null;
  }
}
