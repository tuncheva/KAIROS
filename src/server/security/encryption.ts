/**
 * Server-side AES-256-GCM encryption for note content.
 *
 * When a user sets a password on a note, the plaintext content is
 * encrypted with a key derived from the password (PBKDF2) before
 * being written to the database. Decryption requires the original
 * password.
 *
 * ## Stored format
 *
 * Current (v2):   "v2:" + base64(<16-byte IV> + <16-byte auth tag> + <ciphertext>)
 * Legacy  (v1):          base64(<16-byte IV> + <16-byte auth tag> + <ciphertext>)
 *
 * The docblock used to say "12-byte auth tag" while the code used 16. The code was
 * right; the comment is fixed.
 *
 * ## Why there is a version marker
 *
 * PBKDF2 iterations have to rise over time as hardware gets cheaper, and existing
 * ciphertext cannot be re-derived without the password — which the server does not
 * store. So the stored value has to say which cost it was written with, or raising
 * the number would make every existing note undecryptable.
 *
 * The marker is the textual prefix "v2:" rather than a byte, deliberately. A
 * leading version *byte* would be ambiguous: legacy values begin with a random IV
 * whose first byte lands on any given value once in 256 notes. Base64 has no ':'
 * in its alphabet, so the prefix cannot occur in a legacy value at all.
 */

import "server-only";
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/** Prefix identifying a v2 payload. Absent means the original 100k-iteration format. */
const V2_PREFIX = "v2:";

/**
 * OWASP's current floor for PBKDF2-HMAC-SHA512 is 210,000. The original 100,000
 * was below guidance; anything written from now on uses the higher cost.
 */
const PBKDF2_ITERATIONS_V2 = 210_000;

/** What v1 payloads were written with. Kept solely to read them back. */
const PBKDF2_ITERATIONS_V1 = 100_000;

/**
 * Derive a 256-bit encryption key from a password + salt using PBKDF2.
 */
function deriveKey(password: string, salt: string, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha512");
}

/**
 * Encrypt plaintext content with a password-derived key.
 * Returns a base64-encoded string containing IV + auth tag + ciphertext.
 */
export function encryptContent(
  plaintext: string,
  password: string,
  salt: string,
): string {
  const key = deriveKey(password, salt, PBKDF2_ITERATIONS_V2);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Pack as: IV (16) + Tag (16) + Ciphertext (variable)
  const packed = Buffer.concat([iv, tag, encrypted]);
  return `${V2_PREFIX}${packed.toString("base64")}`;
}

/**
 * Decrypt content that was encrypted with `encryptContent`.
 * Throws if the password is wrong (auth tag mismatch).
 */
export function decryptContent(
  cipherBase64: string,
  password: string,
  salt: string,
): string {
  const isV2 = cipherBase64.startsWith(V2_PREFIX);
  const body = isV2 ? cipherBase64.slice(V2_PREFIX.length) : cipherBase64;

  const key = deriveKey(
    password,
    salt,
    isV2 ? PBKDF2_ITERATIONS_V2 : PBKDF2_ITERATIONS_V1,
  );
  const packed = Buffer.from(body, "base64");

  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
