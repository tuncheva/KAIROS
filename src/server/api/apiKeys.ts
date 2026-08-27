/**
 * API keys: minting, verifying, revoking.
 *
 * The security-relevant decisions are all here, and each one is a departure from
 * how the password path in this codebase works — for reasons worth stating,
 * because "we hash passwords with argon2, why not keys?" is the obvious question.
 *
 * **Fast hash, not a KDF.** A key is 32 bytes of `randomBytes`; there is nothing
 * to guess. Argon2's slowness buys security against dictionary attack on
 * low-entropy human input, and against a high-entropy random key it buys only
 * ~100ms of CPU on every API request — a self-inflicted denial of service that an
 * attacker can trigger for free by sending garbage keys.
 *
 * **Prefix lookup, then constant-time compare.** The prefix is stored in clear so
 * a key can be located by index rather than by scanning every row and hashing
 * against each. The comparison that decides the answer is still
 * `timingSafeEqual`.
 *
 * **Shown once.** The plaintext exists only in the response to the create call.
 * Nothing stores it, and nothing can recover it — a key you can read back out of
 * the product is a key that leaks with a database backup.
 */

import "server-only";

import crypto from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "~/server/db";
import { apiKeys } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

const log = createLogger("api.keys");

/**
 * Human-visible marker so a leaked key is recognisable in a log or a repo.
 *
 * The point of a distinctive prefix is that secret-scanners and humans can spot
 * one: a bare 43-character base64 string is indistinguishable from a hundred
 * other things, where `kai_...` is obviously a credential that should not be in
 * the file it is in.
 */
const KEY_PREFIX = "kai_";

/** Bytes of entropy in a key. 32 is 256 bits — far past guessable. */
const KEY_BYTES = 32;

/** How much of the key is stored in clear, including the marker. */
const PREFIX_LENGTH = 12;

/**
 * How stale `lastUsedAt` may get before it is written.
 *
 * Updating it on every request would turn every read-only API call into a write
 * and make this the hottest row in the database. An hour's granularity is ample
 * for "is this key still in use?", which is the only question it answers.
 */
const LAST_USED_STALENESS_MS = 60 * 60 * 1000;

function hashKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export interface MintedKey {
  id: number;
  /** The only time this value is ever available. */
  plaintext: string;
  prefix: string;
}

/**
 * Create a key for a user.
 *
 * `base64url` rather than hex: the same entropy in two-thirds the characters, and
 * no `+`/`/` to be mangled by whoever pastes it into a config file.
 */
export async function mintApiKey(input: {
  userId: string;
  label: string;
}): Promise<MintedKey> {
  const secret = crypto.randomBytes(KEY_BYTES).toString("base64url");
  const plaintext = `${KEY_PREFIX}${secret}`;
  const prefix = plaintext.slice(0, PREFIX_LENGTH);

  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: input.userId,
      label: input.label,
      prefix,
      keyHash: hashKey(plaintext),
    })
    .returning({ id: apiKeys.id });

  if (!row) throw new Error("Failed to create API key");

  log.info("api key minted", { userId: input.userId, keyId: row.id });

  return { id: row.id, plaintext, prefix };
}

/**
 * Resolve a presented key to a user, or null.
 *
 * Returns null for every failure mode — malformed, unknown, revoked — without
 * distinguishing them to the caller. The distinction is only useful to someone
 * probing, and the honest response to any of them is the same 401.
 */
export async function verifyApiKey(
  presented: string | null | undefined,
): Promise<{ userId: string; keyId: number } | null> {
  if (!presented?.startsWith(KEY_PREFIX)) return null;
  if (presented.length < PREFIX_LENGTH + 8) return null;

  const prefix = presented.slice(0, PREFIX_LENGTH);

  const [row] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      keyHash: apiKeys.keyHash,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row) return null;

  const presentedHash = hashKey(presented);

  // Both sides are fixed-length hex of the same hash, so the lengths always
  // match and `timingSafeEqual` cannot throw here. Compared this way rather than
  // with `===` because the prefix lookup has already told an attacker they found
  // a real row, and the remaining question is the hash.
  const matches = crypto.timingSafeEqual(
    Buffer.from(presentedHash, "hex"),
    Buffer.from(row.keyHash, "hex"),
  );

  if (!matches) {
    log.warn("api key hash mismatch on a known prefix", { keyId: row.id });
    return null;
  }

  await touchLastUsed(row.id, row.lastUsedAt);

  return { userId: row.userId, keyId: row.id };
}

/** Write `lastUsedAt` only when it has gone stale. */
async function touchLastUsed(
  keyId: number,
  lastUsedAt: Date | null,
): Promise<void> {
  const now = Date.now();
  if (lastUsedAt && now - lastUsedAt.getTime() < LAST_USED_STALENESS_MS) return;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date(now) })
    .where(eq(apiKeys.id, keyId));
}

/**
 * Revoke a key.
 *
 * Ownership is in the `where` clause rather than checked first: a separate read
 * would be a race, and an update matching no row is the correct outcome for
 * somebody else's key id.
 */
export async function revokeApiKey(input: {
  userId: string;
  keyId: number;
}): Promise<boolean> {
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, input.keyId),
        eq(apiKeys.userId, input.userId),
        // Already-revoked stays at its original timestamp: when trust was
        // withdrawn is the useful fact, not when someone last pressed the button.
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  return revoked.length > 0;
}

/** A user's keys, for the settings list. Never includes a hash. */
export async function listApiKeys(userId: string) {
  return db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.id);
}

/** Exposed for tests: the shape a key takes. */
export const KEY_FORMAT = {
  prefix: KEY_PREFIX,
  prefixLength: PREFIX_LENGTH,
  bytes: KEY_BYTES,
} as const;
