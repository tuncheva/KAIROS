/**
 * What each plan costs and how it is described — the sellable side of a plan.
 *
 * Separate from `~/lib/entitlements`, which says what a plan *grants*. The two
 * are different rates of change: entitlement flags move when engineering ships
 * something, prices and copy move when the business decides to charge
 * differently, and a marketing edit should never sit in the same diff as a
 * change to what the rate limiter permits.
 *
 * Pure and client-importable, like `entitlements`. The Stripe price IDs these
 * correspond to are deliberately *not* here — they are environment-specific
 * secrets-adjacent identifiers that live in `~/server/billing/stripe`, because a
 * test-mode price ID inlined into the client bundle is how a production checkout
 * quietly charges nothing.
 *
 * Figures are from `docs/business/pricing-strategy.html`.
 */

import type { PlanId } from "./entitlements";

/** How often a subscription renews. */
export type BillingInterval = "month" | "year";

/**
 * A plan someone can actually buy.
 *
 * `free` is excluded by construction rather than by a runtime check: there is no
 * checkout session for it, and a type that admits one invites a call site that
 * tries.
 */
export type PurchasablePlan = Exclude<PlanId, "free">;

export const PURCHASABLE_PLANS = ["pro", "team"] as const satisfies readonly PurchasablePlan[];

export function isPurchasablePlan(value: string): value is PurchasablePlan {
  return (PURCHASABLE_PLANS as readonly string[]).includes(value);
}

export interface PlanPricing {
  /** Monthly price in euro cents, charged per seat. */
  monthly: number;
  /**
   * Annual price in euro cents, per seat, billed once.
   *
   * Two months free, which is the memo's recommendation and the reason this is
   * stored rather than derived: `monthly * 10` happens to be right today, and
   * encoding that arithmetic would silently re-derive the discount if either
   * number is ever tuned independently.
   */
  annual: number;
}

export interface PlanDescriptor {
  id: PlanId;
  /** The one-word promise. Free asks, Pro anticipates, Team coordinates. */
  name: string;
  /** A sentence someone could repeat to a colleague. */
  tagline: string;
  /** Null for Free — it has no price, not a price of zero to render. */
  pricing: PlanPricing | null;
  /**
   * Seats that must be bought before the plan makes sense.
   *
   * Team is three because a coordination tier sold to one person is a Pro
   * subscription with a worse price. Enforced at checkout, not merely displayed.
   */
  minimumSeats: number;
  /** Whether the subscription belongs to an organization rather than a person. */
  perOrganization: boolean;
  /** Bullets, in the order the pricing memo argues them. */
  highlights: readonly string[];
}

export const PLAN_CATALOGUE: Record<PlanId, PlanDescriptor> = {
  free: {
    id: "free",
    name: "Ask",
    tagline: "The whole assistant, on your initiative.",
    pricing: null,
    minimumSeats: 1,
    perOrganization: false,
    highlights: [
      "All 5 conversational agents",
      "All workspace tools",
      "15 AI requests per day",
      "Unlimited confirm & apply",
      "30 days of conversation history",
      "Export your tasks as CSV",
    ],
  },
  pro: {
    id: "pro",
    name: "Anticipate",
    tagline: "It starts noticing things before you do.",
    pricing: { monthly: 1200, annual: 12000 },
    minimumSeats: 1,
    perOrganization: false,
    highlights: [
      "Daily Brief and Risk Radar, on your schedule",
      "Weekly retrospective and deadline watch",
      "200 AI requests per day",
      "Per-agent memory and unlimited history",
      "Documents the agents can read and cite",
      "API keys, webhooks and calendar sync",
      "Undo, plan diffs and the tool inspector",
      "Export as Markdown, CSV or ICS",
    ],
  },
  team: {
    id: "team",
    name: "Coordinate",
    tagline: "Everything in Pro, across an organization.",
    pricing: { monthly: 2200, annual: 22000 },
    minimumSeats: 3,
    perOrganization: true,
    highlights: [
      "Org Admin agent — roles and membership by chat",
      "Shared organization memory",
      "Risk Radar across the whole org",
      "Audit trail of every applied change",
      "Priority model tier on long turns",
      "Minimum 3 seats",
    ],
  },
};

/** The per-seat price of a plan on a given interval, in euro cents. */
export function priceFor(plan: PurchasablePlan, interval: BillingInterval): number {
  const pricing = PLAN_CATALOGUE[plan].pricing!;
  return interval === "year" ? pricing.annual : pricing.monthly;
}

/**
 * "€12" / "€12.50" — cents rendered only when they carry information.
 *
 * Every price in the catalogue is currently whole euros, so a hardcoded
 * `.00` would be noise on every plan card. Kept general anyway, because the
 * first price that is not round would otherwise render as "€12.5".
 */
export function formatEuro(cents: number): string {
  return cents % 100 === 0
    ? `€${cents / 100}`
    : `€${(cents / 100).toFixed(2)}`;
}

/**
 * What an annual subscription saves against paying monthly, as a percentage.
 *
 * Shown on the interval toggle. Derived rather than written down, so it cannot
 * disagree with the two numbers it summarises.
 */
export function annualSavingPercent(plan: PurchasablePlan): number {
  const { monthly, annual } = PLAN_CATALOGUE[plan].pricing!;
  return Math.round((1 - annual / (monthly * 12)) * 100);
}
