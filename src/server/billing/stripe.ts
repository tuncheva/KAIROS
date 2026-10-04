/**
 * The Stripe client and the price catalogue — the only module that talks to
 * Stripe's SDK.
 *
 * Everything above this file deals in `PlanId` and `BillingInterval`. Stripe's
 * vocabulary — price ids, subscription objects, customer handles — stops here,
 * so that swapping the provider, or stubbing it in a test, is one module rather
 * than a search for `stripe.` across the server.
 *
 * **The client is lazy and may not exist.** Stripe is optional configuration
 * (see `~/env`), so this exposes `isBillingConfigured()` rather than a client
 * that throws on import. A missing key must degrade to "you cannot check out
 * right now", not to a 500 on every page that happens to render a plan badge.
 */

import "server-only";

import Stripe from "stripe";

import { env } from "~/env";
import { createLogger } from "~/server/logger";
import type { PlanId } from "~/lib/entitlements";
import type { BillingInterval, PurchasablePlan } from "~/lib/plans";

const log = createLogger("billing:stripe");

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: Stripe | null = null;
let warned = false;

/**
 * Whether checkout can be offered at all.
 *
 * Both halves are required, and the webhook secret is not optional-in-practice:
 * a deployment that can create checkout sessions but cannot verify the webhook
 * takes money and never grants the plan, which is worse than not selling.
 */
export function isBillingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

/**
 * The shared client, or null when Stripe is not configured.
 *
 * Memoised because `new Stripe()` builds an HTTP agent with its own connection
 * pool; one per call would leak sockets under any real traffic.
 *
 * `apiVersion` is pinned rather than left to the SDK default. Stripe's default
 * is whatever the *account* is set to, which means a dashboard toggle by someone
 * else can change the shape of the objects this code parses, at runtime, with no
 * deploy. Pinning turns that into a deliberate upgrade.
 */
export function stripe(): Stripe | null {
  if (client) return client;

  if (!env.STRIPE_SECRET_KEY) {
    if (!warned) {
      warned = true;
      log.warn(
        "STRIPE_SECRET_KEY is unset — checkout, the billing portal and the webhook are disabled. Plans still resolve; nobody can buy one.",
      );
    }
    return null;
  }

  client = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-08-26.dahlia",
    typescript: true,
    // Surfaces this app by name in the Stripe dashboard's request logs, which is
    // the difference between a debuggable failed payment and an anonymous one.
    appInfo: { name: "KAIROS", url: env.NEXT_PUBLIC_APP_URL ?? undefined },
    maxNetworkRetries: 2,
  });

  return client;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Price id for a plan on an interval, or null when it is not configured.
 *
 * Null rather than a throw: a deployment may legitimately sell Pro and not Team,
 * or monthly and not annual, and the pricing page should hide what it cannot
 * sell rather than render a button that 500s.
 */
export function priceIdFor(
  plan: PurchasablePlan,
  interval: BillingInterval,
): string | null {
  if (plan === "pro") {
    return (
      (interval === "year"
        ? env.STRIPE_PRICE_PRO_ANNUAL
        : env.STRIPE_PRICE_PRO_MONTHLY) ?? null
    );
  }
  return (
    (interval === "year"
      ? env.STRIPE_PRICE_TEAM_ANNUAL
      : env.STRIPE_PRICE_TEAM_MONTHLY) ?? null
  );
}

/**
 * Which plan a Stripe price id corresponds to.
 *
 * The inverse of {@link priceIdFor}, and the webhook's only way to know what was
 * bought: a `customer.subscription.updated` for a plan change arrives with the
 * new price and nothing else that names a tier.
 *
 * Built by inverting the same env vars rather than maintained as a second map,
 * because two hand-written directions of the same mapping is how an upgrade to
 * Team grants Pro.
 */
export function planFromPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;

  if (
    priceId === env.STRIPE_PRICE_PRO_MONTHLY ||
    priceId === env.STRIPE_PRICE_PRO_ANNUAL
  ) {
    return "pro";
  }
  if (
    priceId === env.STRIPE_PRICE_TEAM_MONTHLY ||
    priceId === env.STRIPE_PRICE_TEAM_ANNUAL
  ) {
    return "team";
  }
  return null;
}

/**
 * Whether a given plan can actually be bought in this deployment.
 *
 * Read by the pricing page so an unconfigured tier renders as "contact us"
 * rather than a checkout button that cannot produce a session.
 */
export function isPlanPurchasable(plan: PurchasablePlan): boolean {
  return (
    isBillingConfigured() &&
    (priceIdFor(plan, "month") !== null || priceIdFor(plan, "year") !== null)
  );
}

/**
 * Absolute URL for a path, for Stripe's redirect targets.
 *
 * Stripe rejects relative `success_url`s, so this has to resolve to something
 * absolute. Falling back to localhost is right for development and wrong for
 * production — but a production deployment without `NEXT_PUBLIC_APP_URL` has a
 * broken OAuth callback too, so this is not the place that discovers it.
 */
export function absoluteUrl(path: string): string {
  const base = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}
