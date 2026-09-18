/**
 * Re-reading Stripe on a timer — the backstop the webhook never had.
 *
 * Until this existed, `POST /api/stripe/webhook` was the only thing that could
 * move a plan, which made every billing outcome contingent on a delivery. Three
 * failures followed from that and none of them could heal:
 *
 * 1. **A webhook outage longer than the grace window.** `PERIOD_END_GRACE_MS` is
 *    three days. An endpoint that is down, misconfigured or disabled by Stripe
 *    for longer than that silently drops paying customers to Free, and nothing
 *    puts them back until their *next* event — which for an annual subscriber is
 *    eleven months away.
 * 2. **A subscription that never resolved to an owner.** `syncSubscription` logs
 *    an error and returns; the money has moved and nobody got anything. There
 *    was no second attempt, so the repair was a manual database edit by whoever
 *    read the log.
 * 3. **A `deleted` that never arrived.** The row keeps a plan whose subscription
 *    no longer exists, capped only by the same three-day window.
 *
 * Stripe is the source of truth and `syncSubscription` is written to be safe to
 * re-run, so the fix is simply to ask again, regularly. That is all this is.
 *
 * ## Two directions, because one is not enough
 *
 * Reading Stripe's live subscriptions fixes (1) and (2) but cannot see (3) — a
 * subscription that ended is not in the live list, so nothing would ever visit
 * the stale row. Reading local rows fixes (3) but cannot see (2), because a
 * subscription that never resolved to an owner left no row to read. So both.
 *
 * ## Throttled, not scheduled
 *
 * It rides the five-minute tick that already carries the other sweeps rather
 * than getting a scheduler of its own, and refuses to run more than hourly.
 * Reconciliation is a repair for something rare; running it every five minutes
 * would be twelve times the Stripe traffic for the same answer.
 */

import "server-only";

import { isNotNull } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "~/server/db";
import { users } from "~/server/db/schemas/users";
import { organizations } from "~/server/db/schemas/organizations";
import { createLogger } from "~/server/logger";
import { isLiveSubscription } from "~/lib/subscription-status";
import { isBillingConfigured, stripe } from "./stripe";
import {
  clearSubscription,
  clearSubscriptionIfCurrent,
  normaliseStatus,
  ownerFromMetadata,
  syncSubscription,
  type BillingOwner,
} from "./subscriptions";

const log = createLogger("billing:reconcile");

/** How often the sweep is allowed to actually do anything. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A ceiling on one pass, so a Stripe account shared with something else — or a
 * pagination bug — cannot turn a background tick into an unbounded job.
 */
const MAX_SUBSCRIPTIONS = 1000;

/** The statuses worth pulling from Stripe. Dead ones are reached from the local side. */
const LIVE_STATUSES = ["active", "trialing", "past_due"] as const;

export interface ReconcileReport {
  ran: boolean;
  /** Why it did nothing, when it did nothing. */
  skipped?: "unconfigured" | "throttled";
  /** Live subscriptions at Stripe that this deployment recognises as its own. */
  scanned: number;
  /** Rows brought back into agreement with Stripe. */
  synced: number;
  /** Rows dropped to Free because Stripe no longer has a live subscription. */
  cleared: number;
  /** Live subscriptions at Stripe that resolve to no row here — money with no owner. */
  unowned: number;
  /** Subscriptions this pass could not finish. Logged individually. */
  failed: number;
}

let lastRunAt = 0;

/**
 * Bring the database back into agreement with Stripe.
 *
 * Safe to call on any schedule and safe to call concurrently with the webhook:
 * everything it does goes through the same single writer, which writes absolute
 * state rather than deltas.
 *
 * Never throws. A reconciliation that fails is a repair that did not happen, and
 * the caller — a background tick that has already done other useful work — must
 * not be failed by it.
 */
export async function reconcileSubscriptions(
  options: { force?: boolean } = {},
): Promise<ReconcileReport> {
  const empty: ReconcileReport = {
    ran: false,
    scanned: 0,
    synced: 0,
    cleared: 0,
    unowned: 0,
    failed: 0,
  };

  if (!isBillingConfigured()) return { ...empty, skipped: "unconfigured" };

  const client = stripe();
  if (!client) return { ...empty, skipped: "unconfigured" };

  if (!options.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) {
    return { ...empty, skipped: "throttled" };
  }
  lastRunAt = Date.now();

  const report: ReconcileReport = { ...empty, ran: true };
  const seen = new Set<string>();
  const known = await storedSubscriptions();

  await pullFromStripe(client, report, seen, known);
  await pushLocalRows(client, report, seen, known);

  // Only interesting when it found something. A quiet sweep every hour is noise;
  // a sweep that had to repair something is the signal that a delivery was lost.
  const repaired = report.synced + report.cleared + report.unowned + report.failed;
  if (repaired > 0) log.warn("reconciliation made corrections", { ...report });
  else log.debug("reconciliation found nothing to do", { scanned: report.scanned });

  return report;
}

/**
 * Stripe → here. Every subscription Stripe is still collecting on, re-applied.
 *
 * This is the half that fixes a missed grant: a `checkout.session.completed`
 * that never arrived, or one that arrived and could not find an owner, is simply
 * read again here, by which time the metadata and the row both exist.
 */
async function pullFromStripe(
  client: Stripe,
  report: ReconcileReport,
  seen: Set<string>,
  known: Map<string, BillingOwner>,
): Promise<void> {
  // Counts every subscription the listing hands back, not just ours, because
  // the ceiling is there to bound the *work* — a shared account full of another
  // deployment's subscriptions is exactly the case where skipping them all
  // cheaply would still mean paginating through thousands.
  let visited = 0;

  for (const status of LIVE_STATUSES) {
    try {
      for await (const subscription of client.subscriptions.list({
        status,
        limit: 100,
      })) {
        if (++visited > MAX_SUBSCRIPTIONS) {
          log.error("reconciliation hit its subscription ceiling; stopping early", {
            ceiling: MAX_SUBSCRIPTIONS,
          });
          return;
        }

        // A Stripe account is often shared between environments — a sandbox and
        // a production deployment, or two of each. A subscription that carries
        // none of our metadata and matches no row here belongs to one of the
        // others, and is not evidence of anything. Skipped silently, because
        // `syncSubscription` would otherwise log "no owner" at error level for
        // every one of them, once an hour, forever — and a channel that cries
        // wolf hourly is where the one real orphan goes unnoticed.
        if (!ownerFromMetadata(subscription.metadata) && !known.has(subscription.id)) {
          continue;
        }

        report.scanned += 1;
        seen.add(subscription.id);

        try {
          const owner = await syncSubscription(subscription);
          if (owner) report.synced += 1;
          // `syncSubscription` has already logged the details at error level;
          // counting it here is what makes it visible without reading logs.
          else report.unowned += 1;
        } catch (err) {
          report.failed += 1;
          log.error("could not reconcile a subscription", {
            subscriptionId: subscription.id,
            err,
          });
        }
      }
    } catch (err) {
      report.failed += 1;
      log.error("could not list subscriptions from Stripe", { status, err });
    }
  }
}

/**
 * Here → Stripe. Every row still claiming a subscription Stripe did not just
 * hand us.
 *
 * A subscription absent from the live list has either ended or never existed.
 * Both mean the row is stale, but only Stripe can say which — so each one is
 * retrieved individually rather than assumed dead. The alternative, treating
 * "not in the list" as "cancelled", would revoke every paying customer the first
 * time a pagination call failed halfway through.
 */
async function pushLocalRows(
  client: Stripe,
  report: ReconcileReport,
  seen: Set<string>,
  known: Map<string, BillingOwner>,
): Promise<void> {
  for (const [subscriptionId, owner] of known) {
    if (seen.has(subscriptionId)) continue;
    try {
      const subscription = await client.subscriptions.retrieve(subscriptionId);

      if (isLiveSubscription(normaliseStatus(subscription.status))) {
        // In the live list's blind spot — created between the two passes, say.
        // Re-applying is harmless and is the whole point of the exercise.
        await syncSubscription(subscription);
        report.synced += 1;
      } else {
        await clearSubscriptionIfCurrent(subscription);
        report.cleared += 1;
      }
    } catch (err) {
      // Gone from Stripe entirely. Nothing is billing, so the row is simply
      // wrong and clearing it is the complete answer.
      if (isResourceMissing(err)) {
        log.warn("row names a subscription Stripe does not have; clearing", {
          ownerKind: owner.kind,
          ownerId: String(owner.id),
          subscriptionId,
        });
        await clearSubscription(owner);
        report.cleared += 1;
        continue;
      }

      report.failed += 1;
      log.error("could not check a stored subscription against Stripe", {
        ownerKind: owner.kind,
        ownerId: String(owner.id),
        subscriptionId,
        err,
      });
    }
  }
}

/**
 * Every subscription id this database currently claims, and who holds it.
 *
 * Read once per sweep and used by both halves: it tells the Stripe pass which
 * subscriptions are ours to care about, and it is the worklist for the local
 * pass. Bounded by the number of paying customers, which is the right order of
 * magnitude to hold in memory.
 */
async function storedSubscriptions(): Promise<Map<string, BillingOwner>> {
  const known = new Map<string, BillingOwner>();

  const userRows = await db
    .select({ id: users.id, subscriptionId: users.stripeSubscriptionId })
    .from(users)
    .where(isNotNull(users.stripeSubscriptionId));

  for (const row of userRows) {
    if (row.subscriptionId) known.set(row.subscriptionId, { kind: "user", id: row.id });
  }

  const orgRows = await db
    .select({ id: organizations.id, subscriptionId: organizations.stripeSubscriptionId })
    .from(organizations)
    .where(isNotNull(organizations.stripeSubscriptionId));

  for (const row of orgRows) {
    if (row.subscriptionId) {
      known.set(row.subscriptionId, { kind: "organization", id: row.id });
    }
  }

  return known;
}

/** Stripe's "this object does not exist" shape, without importing its error classes. */
function isResourceMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "resource_missing"
  );
}
