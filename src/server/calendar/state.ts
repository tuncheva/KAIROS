/**
 * The signed `state` parameter for the calendar OAuth flow.
 *
 * Split from the route because the route imports NextAuth, which drags in Next's
 * server internals and cannot be loaded in a unit test. This is the CSRF defence
 * for the callback — without it a crafted callback URL could bind an attacker's
 * calendar to whoever clicks it — so it is exactly the code that should be cheap
 * to exercise.
 */

import "server-only";

import crypto from "node:crypto";

import { env } from "~/env";

/** How long a started flow stays valid. Long enough to read a consent screen. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export function signState(userId: string, issuedAt: number): string {
  const payload = `${userId}.${String(issuedAt)}`;
  const mac = crypto
    .createHmac("sha256", env.AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export interface VerifiedState {
  userId: string;
  issuedAt: number;
}

/**
 * Verify a state parameter.
 *
 * Compared in constant time, and the payload is re-signed rather than parsed and
 * trusted — the signature covers exactly the bytes that produce the user id, so
 * there is no room for the two to disagree.
 */
export function verifyState(state: string, now = Date.now()): VerifiedState | null {
  const [encoded, mac] = state.split(".");
  if (!encoded || !mac) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", env.AUTH_SECRET)
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const separator = payload.lastIndexOf(".");
  if (separator < 1) return null;

  const userId = payload.slice(0, separator);
  const issuedAt = Number(payload.slice(separator + 1));

  if (!userId || Number.isNaN(issuedAt)) return null;
  // An expired state is refused rather than accepted late: a flow left open for
  // an hour is more likely to be a stale tab than a slow reader.
  if (now - issuedAt > STATE_TTL_MS || issuedAt > now + 60_000) return null;

  return { userId, issuedAt };
}
