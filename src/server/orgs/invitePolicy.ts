/**
 * The rules an invitation email has to keep, in one place.
 *
 * Every workspace invite to an address is an email KAIROS sends to someone who
 * may never have heard of it. What keeps that a transactional access grant —
 * rather than the platform advertising GDPR and anti-spam law treat as needing
 * consent (BGH I ZR 65/14, *Freunde finden*; ZES Art. 261; ZET Arts. 5–6) — is
 * that it is one message, from a named person, that the recipient can stop.
 * This module is that "can stop" and "one message":
 *
 * - a keyed-hash suppression list, checked before every send;
 * - a self-contained opt-out token for the email's "don't invite me again" link;
 * - a per-inviter and per-workspace budget on invites and identity lookups;
 * - a cap on manual resends, and no automatic reminders anywhere;
 * - a retention sweep that deletes finished invitations after 30 days.
 *
 * Reasoning and sources: docs/invite-email-legal-research-2026-10-08.md §6.
 */

import "server-only";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, ne, sql } from "drizzle-orm";

import { env } from "~/env";
import type { db as Database } from "~/server/db";
import { inviteSuppressions, organizationInvites } from "~/server/db/schema";
import { ts } from "~/server/db/timestamp";
import { readWindow, recordHit } from "~/server/security/slidingWindow";

type Db = typeof Database;

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hmac(purpose: string, value: string): string {
  return crypto
    .createHmac("sha256", env.AUTH_SECRET)
    .update(`${purpose}:${value}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/** The keyed hash an address is stored under. Never reversible to the address. */
export function suppressionHash(email: string): string {
  return hmac("invite-suppression", normalizeEmail(email));
}

/** Whether this address asked not to be sent invitations. */
export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: inviteSuppressions.id })
    .from(inviteSuppressions)
    .where(eq(inviteSuppressions.emailHash, suppressionHash(email)))
    .limit(1);
  return Boolean(row);
}

/**
 * The token behind "Don't send me KAIROS invitations again".
 *
 * It carries the address's suppression hash and a signature over it — not the
 * address, and not an invite id. So the link works after the invite itself has
 * been deleted, and a URL that ends up in a log or a referrer says nothing about
 * whose it was.
 */
export function optOutToken(email: string): string {
  const hash = suppressionHash(email);
  return `${hash}.${hmac("invite-optout", hash).slice(0, 32)}`;
}

/** The suppression hash a token stands for, or null if it was not ours. */
export function verifyOptOutToken(token: string): string | null {
  const match = /^([0-9a-f]{64})\.([0-9a-f]{32})$/.exec(token);
  if (!match) return null;
  const [, hash, sig] = match as unknown as [string, string, string];
  const expected = Buffer.from(hmac("invite-optout", hash).slice(0, 32));
  const given = Buffer.from(sig);
  if (!crypto.timingSafeEqual(expected, given)) return null;
  return hash;
}

/**
 * Honour an opt-out: suppress the address, and withdraw what is still pending.
 *
 * Idempotent — the link may be followed twice, or by a mail scanner first.
 * Pending invites to the address are cancelled rather than left for a resend to
 * revive: the person has told us they do not want them.
 */
export async function suppressByToken(db: Db, token: string): Promise<boolean> {
  const hash = verifyOptOutToken(token);
  if (!hash) return false;

  await db
    .insert(inviteSuppressions)
    .values({ emailHash: hash })
    .onConflictDoNothing();

  // The table stores addresses, so each pending row is hashed to find the match.
  // Pending invites are few and short-lived; this is not a hot path.
  const pending = await db
    .select({ id: organizationInvites.id, email: organizationInvites.email })
    .from(organizationInvites)
    .where(eq(organizationInvites.status, "pending"));
  for (const row of pending) {
    if (suppressionHash(row.email) !== hash) continue;
    await db
      .update(organizationInvites)
      .set({ status: "cancelled" })
      .where(eq(organizationInvites.id, row.id));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * Invites and identity lookups per day.
 *
 * GitHub starts new organizations at 50 invitations a day; the lookup budget is
 * wider because it is spent while typing, but it is still a cap — without one,
 * the lookup is a free oracle for "which of these addresses are colleagues".
 */
export const INVITES_PER_INVITER_PER_DAY = 50;
export const INVITES_PER_ORG_PER_DAY = 200;
export const LOOKUPS_PER_INVITER_PER_DAY = 200;

async function spend(key: string, limit: number, message: string) {
  const now = Date.now();
  const { count } = await readWindow(key, DAY_MS, now);
  if (count >= limit) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
  }
  await recordHit(key, DAY_MS, now);
}

/** Spend one invitation email from the inviter's and the workspace's budget. */
export async function consumeInviteBudget(inviterId: string, organizationId: number) {
  await spend(
    `invite:user:${inviterId}`,
    INVITES_PER_INVITER_PER_DAY,
    "You have sent a lot of invitations today. Try again tomorrow.",
  );
  await spend(
    `invite:org:${organizationId}`,
    INVITES_PER_ORG_PER_DAY,
    "This workspace has sent a lot of invitations today. Try again tomorrow.",
  );
}

/** Spend one invitee lookup. */
export async function consumeLookupBudget(inviterId: string) {
  await spend(
    `invite-lookup:user:${inviterId}`,
    LOOKUPS_PER_INVITER_PER_DAY,
    "Too many lookups today. You can still send invitations.",
  );
}

// ---------------------------------------------------------------------------
// Resends
// ---------------------------------------------------------------------------

/** The first email plus this many manual resends; never automatic. */
export const MAX_RESENDS = 2;
export const RESEND_GAP_MS = DAY_MS;

/** Refuse a resend that would turn one invitation into a sequence of emails. */
export function assertCanResend(
  invite: { sendCount: number; lastSentAt: Date | null; createdAt: Date },
  now = Date.now(),
) {
  if (invite.sendCount > MAX_RESENDS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "This invitation has already been resent twice.",
    });
  }
  const last = (invite.lastSentAt ?? invite.createdAt).getTime();
  if (now - last < RESEND_GAP_MS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "An invitation can be resent once a day.",
    });
  }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** How long a finished invitation (and the address on it) is kept. */
export const INVITE_RETENTION_MS = 30 * DAY_MS;

/**
 * Delete invitations that ended more than 30 days ago.
 *
 * "Ended" means expired, declined or cancelled, or still marked pending past its
 * expiry. Accepted invitations are kept: the address on them is now the member's
 * own account address, and the workspace's invite history reads them.
 */
export async function purgeStaleInvites(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INVITE_RETENTION_MS);
  const removed = await db
    .delete(organizationInvites)
    .where(
      and(
        ne(organizationInvites.status, "accepted"),
        // `ts()`: a bare Date inside raw `sql` throws at bind time.
        sql`coalesce(${organizationInvites.expiresAt}, ${organizationInvites.createdAt}) < ${ts(cutoff)}`,
      ),
    )
    .returning({ id: organizationInvites.id });
  return removed.length;
}
