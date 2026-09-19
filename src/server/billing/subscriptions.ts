/**
 * Writing subscription state into the database — the only module that does.
 *
 * Every column added by `0045_billing` is written here and nowhere else. That
 * single-writer rule is what makes the denormalised `plan` column safe: the
 * question "under what circumstances does someone have Pro?" has one answer, in
 * {@link planFromSubscription}, instead of being re-decided by each caller that
 * happens to have a Stripe object in hand.
 *
 * **Stripe is the source of truth; this is a cache of it.** Nothing here decides
 * anything — it transcribes what Stripe already believes. The consequence is
 * that the correct response to *any* doubt is to re-read the subscription from
 * Stripe and re-apply it, which {@link syncSubscription} is written to be safe
 * to do repeatedly.
 */

import "server-only";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "~/server/db";
import { users } from "~/server/db/schemas/users";
import { organizations } from "~/server/db/schemas/organizations";
import { createLogger } from "~/server/logger";
import type { PlanId } from "~/lib/entitlements";
import {
  accessEndsAt,
  isLiveSubscription,
  planToRecord,
  willNotRenew,
  type SubscriptionStatus,
} from "~/lib/subscription-status";
import { planFromPriceId } from "./stripe";

const log = createLogger("billing:subscriptions");

// Re-exported so callers keep importing the billing vocabulary from the billing
// module; the definitions live in `~/lib/subscription-status` because they are
// pure and this file is not — see that file's docblock.
export {
  planFromSubscription,
  planToRecord,
  isLiveSubscription,
  willNotRenew,
  accessEndsAt,
  type SubscriptionStatus,
} from "~/lib/subscription-status";

/**
 * Who a subscription belongs to.
 *
 * Personal subscriptions live on `user`, Team subscriptions on `organizations`.
 * The two tables carry the same columns, so everything below is written once
 * against this discriminator rather than twice.
 */
export type BillingOwner =
  | { kind: "user"; id: string }
  | { kind: "organization"; id: number };

// ---------------------------------------------------------------------------
// Interpreting Stripe
// ---------------------------------------------------------------------------

/**
 * Narrow Stripe's status vocabulary to the five we store.
 *
 * `unpaid` and `paused` become `canceled` because by the time a subscription
 * reaches either, Stripe has already stopped collecting and the subscriber has
 * stopped being entitled — keeping them distinct would add two values that every
 * future branch has to remember to handle identically to `canceled`.
 */
function normaliseStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  // Each arm names its own literal rather than falling through to `return
  // status`. Stripe types the status as a union *plus* an opaque string, so the
  // SDK can name a state this build has never heard of without a major version
  // bump — which means `return status` does not narrow, and the four statuses we
  // do understand cannot be passed through by identity.
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    // `unpaid`, `paused` and `incomplete_expired` collapse here, and so does any
    // status a future Stripe invents. Defaulting an unknown state to `canceled`
    // is the safe direction: the failure mode is a subscriber who has to contact
    // support, not a cancelled subscriber who keeps the plan indefinitely.
    default:
      return "canceled";
  }
}

/**
 * The plan a subscription's line items represent.
 *
 * Reads the first item's price. Multi-item subscriptions are not something this
 * product sells — one plan, N seats, is the whole model — so a second item would
 * mean something was created outside this code, and guessing at how to merge two
 * tiers would be worse than recording the first and logging it.
 */
function planOf(subscription: Stripe.Subscription): PlanId | null {
  const item = subscription.items.data[0];
  if (subscription.items.data.length > 1) {
    log.warn("subscription has multiple items; reading the first", {
      subscriptionId: subscription.id,
      items: subscription.items.data.length,
    });
  }
  return planFromPriceId(item?.price.id);
}

/** Seats bought. One when Stripe reports no quantity — a subscription is at least one seat. */
function seatsOf(subscription: Stripe.Subscription): number {
  return subscription.items.data[0]?.quantity ?? 1;
}

/**
 * When access ends — the renewal date, or the cancellation date if sooner.
 *
 * Read from the subscription item rather than the subscription, because Stripe
 * moved `current_period_end` onto items — a subscription-level read returns
 * undefined on current API versions and would silently store `null`, which the
 * resolver reads as "never expires".
 *
 * `cancel_at` is folded in by {@link accessEndsAt} because a portal cancellation
 * can name any date, not only a period boundary, and the column feeds both the
 * date on the billing screen and the resolver's grace window.
 */
function periodEndOf(subscription: Stripe.Subscription): Date | null {
  const seconds = subscription.items.data[0]?.current_period_end;
  const endsAt = accessEndsAt({
    current_period_end: typeof seconds === "number" ? seconds : null,
    cancel_at: subscription.cancel_at,
    cancel_at_period_end: subscription.cancel_at_period_end,
  });
  return endsAt === null ? null : new Date(endsAt * 1000);
}

/** Stripe hands back either an id or an expanded object; we only ever want the id. */
export function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * The owner a subscription's metadata names.
 *
 * Checkout stamps `kairosOwnerKind` and `kairosOwnerId` onto the subscription's
 * metadata, and this reads them back. It is the only link from a Stripe object
 * to a row, and it is deliberately not "look up the customer id": a webhook can
 * arrive for a subscription created before its customer id was ever persisted —
 * `checkout.session.completed` and `customer.subscription.created` race, and
 * Stripe does not guarantee which lands first.
 */
export function ownerFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): BillingOwner | null {
  const kind = metadata?.kairosOwnerKind;
  const id = metadata?.kairosOwnerId;
  if (!id) return null;

  if (kind === "organization") {
    const numeric = Number(id);
    return Number.isInteger(numeric) ? { kind: "organization", id: numeric } : null;
  }
  if (kind === "user") return { kind: "user", id };
  return null;
}

/**
 * Apply a Stripe subscription to its owner's row.
 *
 * Idempotent by construction: it writes absolute state read from the
 * subscription rather than applying a delta, so replaying the same event — which
 * Stripe *will* do, since it retries any delivery it did not get a 2xx for —
 * lands on the same values. There is no event-id ledger for that reason; the
 * cheapest idempotency is an operation that does not care how many times it runs.
 *
 * Out-of-order delivery is the case this does not fully solve, and the residual
 * risk is accepted: an `updated` arriving after a `deleted` would resurrect a
 * cancelled plan until the next event. The mitigation is that cancellation also
 * sets `currentPeriodEnd`, which the resolver enforces independently.
 *
 * The one out-of-order case that is *not* accepted is a late event about a
 * subscription the owner has already replaced — see {@link supersedes}. That one
 * takes a paying customer's plan away, which no later event necessarily puts
 * back.
 */
export async function syncSubscription(
  subscription: Stripe.Subscription,
  fallbackOwner?: BillingOwner | null,
): Promise<BillingOwner | null> {
  const owner =
    ownerFromMetadata(subscription.metadata) ??
    fallbackOwner ??
    (await ownerFromSubscriptionId(subscription.id));

  if (!owner) {
    // Loud, because the money has moved and nobody got anything for it. This is
    // the one failure in the billing path that a user cannot see and cannot
    // report usefully — they simply do not have the plan they paid for.
    log.error("no owner for subscription; plan not applied", {
      subscriptionId: subscription.id,
      customerId: customerIdOf(subscription.customer),
    });
    return null;
  }

  const status = normaliseStatus(subscription.status);

  // A dead subscription that is not the one on file is a late event about
  // something already replaced. Writing it would revoke the plan the owner is
  // currently paying for. A *live* one is allowed through even when the ids
  // differ, because that is exactly what a legitimate replacement looks like.
  if (!isLiveSubscription(status) && (await supersedes(owner, subscription.id))) {
    log.info("ignoring a stale event for a superseded subscription", {
      ownerKind: owner.kind,
      ownerId: String(owner.id),
      subscriptionId: subscription.id,
      status,
    });
    return owner;
  }

  const plan = await resolvePlan(owner, subscription, status);

  const patch = {
    plan,
    stripeCustomerId: customerIdOf(subscription.customer),
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: status,
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: willNotRenew(subscription),
    updatedAt: new Date(),
  };

  if (owner.kind === "organization") {
    await db
      .update(organizations)
      .set({ ...patch, seats: seatsOf(subscription) })
      .where(eq(organizations.id, owner.id));
  } else {
    await db.update(users).set(patch).where(eq(users.id, owner.id));
  }

  log.info("subscription synced", {
    ownerKind: owner.kind,
    ownerId: String(owner.id),
    plan,
    status,
  });

  return owner;
}

/**
 * {@link planToRecord}, plus the database read and the alarm it needs.
 *
 * The rule itself is pure and lives in `~/lib/subscription-status` with the rest
 * of them. What stays here is the part that cannot be: reading the plan already
 * on file to fall back to, and shouting when it is used. The log is `error`
 * rather than `warn` on purpose — it is the same class of event as the missing
 * owner above, money moving with nobody correctly credited, and it wants the
 * same attention.
 */
async function resolvePlan(
  owner: BillingOwner,
  subscription: Stripe.Subscription,
  status: SubscriptionStatus,
): Promise<PlanId> {
  const priced = planOf(subscription);

  if (priced !== null || !isLiveSubscription(status)) {
    return planToRecord(status, priced, null);
  }

  const { plan: onFile } = await billingStateOf(owner);

  log.error("live subscription priced at an unknown plan", {
    ownerKind: owner.kind,
    ownerId: String(owner.id),
    subscriptionId: subscription.id,
    status,
    priceId: subscription.items.data[0]?.price.id ?? null,
    keeping: onFile,
  });

  return planToRecord(status, priced, onFile);
}

/**
 * Find an owner by the subscription id already stored on their row.
 *
 * The fallback path for an event whose metadata is missing — a subscription
 * edited in the Stripe dashboard, say, which does not carry our metadata unless
 * whoever edited it preserved it. Only works after a first successful sync, which
 * is why it is the last resort rather than the first.
 */
async function ownerFromSubscriptionId(
  subscriptionId: string,
): Promise<BillingOwner | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeSubscriptionId, subscriptionId),
    columns: { id: true },
  });
  if (org) return { kind: "organization", id: org.id };

  const user = await db.query.users.findFirst({
    where: eq(users.stripeSubscriptionId, subscriptionId),
    columns: { id: true },
  });
  return user ? { kind: "user", id: user.id } : null;
}

/**
 * The subscription and status currently on file for an owner.
 *
 * Exported because the checkout mutation needs exactly this to decide whether
 * starting a second checkout would double-bill someone, and reaching into the
 * two tables from the router would be the third place that has to remember which
 * columns hold subscription state.
 */
export async function billingStateOf(owner: BillingOwner): Promise<{
  subscriptionId: string | null;
  status: SubscriptionStatus | null;
  /** The tier on file, for {@link planToRecord}'s unmappable-price fallback. */
  plan: PlanId | null;
}> {
  const columns = {
    stripeSubscriptionId: true,
    subscriptionStatus: true,
    plan: true,
  } as const;

  const row =
    owner.kind === "organization"
      ? await db.query.organizations.findFirst({
          where: eq(organizations.id, owner.id),
          columns,
        })
      : await db.query.users.findFirst({
          where: eq(users.id, owner.id),
          columns,
        });

  return {
    subscriptionId: row?.stripeSubscriptionId ?? null,
    status: row?.subscriptionStatus ?? null,
    plan: row?.plan ?? null,
  };
}

/**
 * Whether the owner's row names a *different* subscription than the one in hand.
 *
 * False when nothing is on file: a first sync has no id to disagree with, and
 * treating "unknown" as "superseded" would drop the very first event of every
 * subscription's life.
 */
async function supersedes(
  owner: BillingOwner,
  subscriptionId: string,
): Promise<boolean> {
  const { subscriptionId: current } = await billingStateOf(owner);
  return current !== null && current !== subscriptionId;
}

/**
 * Handle `customer.subscription.deleted` — clear the plan, but only if the
 * subscription that died is the one the owner is actually on.
 *
 * Stripe does not guarantee delivery order, and a cancellation can arrive after
 * its replacement is already live: cancel Pro, buy Team an hour later, and a
 * retried `deleted` for the old subscription lands on an owner who is paying.
 * Clearing unconditionally would drop them to Free with no later event to put it
 * back — unlike the resurrection case, which the next `updated` corrects. So the
 * id is checked first, and a mismatch is ignored rather than applied.
 */
export async function clearSubscriptionIfCurrent(
  subscription: Stripe.Subscription,
): Promise<void> {
  const owner =
    ownerFromMetadata(subscription.metadata) ??
    (await ownerFromSubscriptionId(subscription.id));

  if (!owner) {
    // Not an error. A subscription this deployment never synced — created
    // against another environment sharing the Stripe account, say — has no row
    // to clear, and there is nothing to do about it.
    log.warn("no owner for deleted subscription; nothing to clear", {
      subscriptionId: subscription.id,
      customerId: customerIdOf(subscription.customer),
    });
    return;
  }

  if (await supersedes(owner, subscription.id)) {
    log.info("ignoring deletion of a superseded subscription", {
      ownerKind: owner.kind,
      ownerId: String(owner.id),
      subscriptionId: subscription.id,
    });
    return;
  }

  await clearSubscription(owner);
}

/**
 * Drop an owner back to Free.
 *
 * Separate from {@link syncSubscription} rather than a status it could derive,
 * because `customer.subscription.deleted` is the one event where Stripe's object
 * still describes the plan that just ended — syncing it verbatim would read the
 * price, see Pro, and re-grant what was just cancelled if the status check ever
 * regressed. Clearing explicitly makes that impossible.
 *
 * `stripeCustomerId` is deliberately left in place — see the column's docblock.
 */
export async function clearSubscription(owner: BillingOwner): Promise<void> {
  const patch = {
    plan: "free" as const,
    stripeSubscriptionId: null,
    subscriptionStatus: "canceled" as const,
    cancelAtPeriodEnd: false,
    updatedAt: new Date(),
  };

  if (owner.kind === "organization") {
    await db
      .update(organizations)
      .set({ ...patch, seats: 0 })
      .where(eq(organizations.id, owner.id));
  } else {
    await db.update(users).set(patch).where(eq(users.id, owner.id));
  }

  log.info("subscription cleared", { ownerKind: owner.kind, ownerId: String(owner.id) });
}

/**
 * Remember a Stripe customer against an owner before any subscription exists.
 *
 * Called when checkout creates a customer, so that a second checkout — or a trip
 * to the billing portal — reuses it. Without this, every attempt makes a new
 * Stripe customer and the account's payment history fragments across all of them.
 */
export async function rememberCustomer(
  owner: BillingOwner,
  customerId: string,
): Promise<void> {
  if (owner.kind === "organization") {
    await db
      .update(organizations)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(organizations.id, owner.id));
  } else {
    await db
      .update(users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(users.id, owner.id));
  }
}
