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
import { planFromPriceId } from "./stripe";

const log = createLogger("billing:subscriptions");

/** The statuses `subscription_status` may hold — see the enum's docblock. */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

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
 * Whether a status still entitles the subscriber, and which plan to record.
 *
 * `past_due` deliberately keeps the plan. Stripe retries a failed card for days
 * before giving up, and the overwhelming majority of those retries succeed — an
 * expired card on a Tuesday should produce a dunning email, not a Wednesday where
 * the user's saved schedules stop firing and their history is culled to 30 days.
 * The lockout arrives when Stripe itself gives up and sends `canceled`.
 *
 * `incomplete` does *not* grant anything: it means the first payment has not
 * succeeded yet, so there is no reason to believe it ever will.
 */
export function planFromSubscription(
  status: SubscriptionStatus,
  plan: PlanId | null,
): PlanId {
  if (!plan) return "free";
  return status === "active" || status === "trialing" || status === "past_due"
    ? plan
    : "free";
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
 * When the current paid period ends.
 *
 * Read from the subscription item rather than the subscription, because Stripe
 * moved `current_period_end` onto items — a subscription-level read returns
 * undefined on current API versions and would silently store `null`, which the
 * resolver reads as "never expires".
 */
function periodEndOf(subscription: Stripe.Subscription): Date | null {
  const seconds = subscription.items.data[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
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
  const plan = planFromSubscription(status, planOf(subscription));

  const patch = {
    plan,
    stripeCustomerId: customerIdOf(subscription.customer),
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: status,
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
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
