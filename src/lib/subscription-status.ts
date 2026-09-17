/**
 * What a subscription's status means for entitlement — the pure half.
 *
 * Split out of `~/server/billing/subscriptions` for one reason: this is the
 * decision that costs money if it is wrong, and it was untestable where it
 * lived. That module imports `~/server/db`, which reads `env.DATABASE_URL` at
 * import time, which throws under the jsdom environment the unit suite runs in —
 * so the whole billing spec failed to collect and its assertions silently never
 * ran. A rule this consequential has to be reachable without standing up a
 * database.
 *
 * Nothing here knows about Stripe's SDK. Narrowing Stripe's status vocabulary to
 * this one stays on the server side, in `normaliseStatus`, because that is where
 * the SDK's types belong; everything downstream of that narrowing is pure and
 * lives here.
 */

import type { PlanId } from "./entitlements";

/** The statuses `subscription_status` may hold — see the enum's docblock. */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

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
 * Whether a status represents a subscription that is still on the hook for money.
 *
 * The same three statuses {@link planFromSubscription} grants on, named
 * separately because the question is different: that one asks "does this person
 * have Pro", this one asks "would starting a second checkout double-bill them".
 * They coincide today and are not the same rule — an `incomplete` subscription
 * grants nothing but also must not block the retry that completes it.
 */
export function isLiveSubscription(status: SubscriptionStatus | null): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}
