/**
 * Create the Stripe products and prices the plan catalogue describes.
 *
 * Run with `pnpm stripe:prices`. Reads `STRIPE_SECRET_KEY` from `.env` through
 * `dotenv -e .env --`, so the key never appears on a command line or in shell
 * history.
 *
 * ## Why a script rather than four dashboard clicks
 *
 * The amounts come from `~/lib/plans` rather than being retyped here, so the
 * price Stripe charges cannot drift from the price the pricing page quotes. That
 * mismatch is the one billing bug that arrives as a chargeback rather than as a
 * bug report.
 *
 * ## Idempotent
 *
 * Products are created with deterministic ids and prices with deterministic
 * `lookup_key`s, and both are looked up before being created. Re-running after a
 * partial failure finishes the job instead of producing a second set of prices
 * that quietly compete with the first.
 *
 * ## Test mode only
 *
 * Refuses to run against an `sk_live_` key. Creating a product catalogue is not
 * destructive, but doing it against a live account leaves real purchasable
 * prices on a real business, and the guard costs one line.
 */

import Stripe from "stripe";

import {
  PLAN_CATALOGUE,
  PURCHASABLE_PLANS,
  formatEuro,
  priceFor,
  type BillingInterval,
  type PurchasablePlan,
} from "../src/lib/plans";

const key = process.env.STRIPE_SECRET_KEY;

if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is not set. Run this through `pnpm stripe:prices`, which loads .env.",
  );
  process.exit(1);
}

if (!key.startsWith("sk_test_")) {
  console.error(
    `Refusing to run: STRIPE_SECRET_KEY starts with "${key.slice(0, 8)}", not "sk_test_".\n` +
      "This script creates a product catalogue and must only ever touch a sandbox.",
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" });

/** Deterministic ids, so a re-run finds what the last run made. */
const productId = (plan: PurchasablePlan) => `kairos_${plan}`;
const lookupKey = (plan: PurchasablePlan, interval: BillingInterval) =>
  `kairos_${plan}_${interval}`;

/** The env var each price id belongs in. */
const envVar = (plan: PurchasablePlan, interval: BillingInterval) =>
  `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "ANNUAL" : "MONTHLY"}`;

async function ensureProduct(plan: PurchasablePlan): Promise<string> {
  const id = productId(plan);
  const descriptor = PLAN_CATALOGUE[plan];

  try {
    const existing = await stripe.products.retrieve(id);
    console.log(`  product ${id} — already exists`);
    return existing.id;
  } catch (err) {
    if ((err as Stripe.errors.StripeError).code !== "resource_missing") throw err;
  }

  const created = await stripe.products.create({
    id,
    name: `KAIROS ${descriptor.name}`,
    description: descriptor.tagline,
    metadata: { kairosPlan: plan },
  });

  // The prefix check above reads a string; this reads what the API actually
  // answered. Belt and braces, because the cost of being wrong is a real
  // product on a real business.
  if (created.livemode) {
    throw new Error("Created a LIVE product — aborting before creating prices.");
  }

  console.log(`  product ${id} — created`);
  return created.id;
}

async function ensurePrice(
  plan: PurchasablePlan,
  interval: BillingInterval,
  product: string,
): Promise<string> {
  const key = lookupKey(plan, interval);

  const found = await stripe.prices.list({
    lookup_keys: [key],
    active: true,
    limit: 1,
  });
  if (found.data[0]) {
    console.log(`  price ${key} — already exists`);
    return found.data[0].id;
  }

  const amount = priceFor(plan, interval);
  const created = await stripe.prices.create({
    product,
    lookup_key: key,
    currency: "eur",
    unit_amount: amount,
    recurring: { interval },
    metadata: { kairosPlan: plan, kairosInterval: interval },
  });
  console.log(`  price ${key} — created at ${formatEuro(amount)} per seat`);
  return created.id;
}

async function main() {
  const lines: string[] = [];

  for (const plan of PURCHASABLE_PLANS) {
    console.log(`${PLAN_CATALOGUE[plan].name} (${plan}):`);
    const product = await ensureProduct(plan);

    for (const interval of ["month", "year"] as const) {
      const priceId = await ensurePrice(plan, interval, product);
      lines.push(`${envVar(plan, interval)}=${priceId}`);
    }
    console.log("");
  }

  console.log("Paste these into .env:\n");
  console.log(lines.join("\n"));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
