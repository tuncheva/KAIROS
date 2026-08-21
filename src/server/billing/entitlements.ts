/**
 * What a user is entitled to.
 *
 * KAIROS has no billing yet — no plan column, no payment provider, no
 * subscription lifecycle. This exists so the features that will eventually sit
 * behind a paid tier can be *marked* now, in one place, rather than having the
 * question "is this user paying?" answered ad hoc in a dozen components later.
 *
 * **Nothing is blocked today.** `isPro` returns true for everyone on purpose:
 * a paywall enforced before there is a way to pay is a paywall that locks the
 * product's own authors out of it, and every call site would have to be revisited
 * to unbreak. Marking is reversible; blocking is not.
 *
 * When Stripe lands, exactly one function below changes. Call sites do not.
 */

import "server-only";

import type { TRPCContext } from "~/server/api/trpc";

export type PlanId = "free" | "pro";

export interface Entitlements {
  plan: PlanId;
  /** Register tools of the user's own — an HTTP endpoint or an MCP server. */
  customTools: boolean;
  /** Facts scoped to a single agent, rather than one shared global set. */
  perAgentMemory: boolean;
}

const PRO_ENTITLEMENTS: Entitlements = {
  plan: "pro",
  customTools: true,
  perAgentMemory: true,
};

/**
 * Resolve what this caller may use.
 *
 * The `ctx` parameter is unused and deliberately kept: it is the argument the
 * real implementation needs, and adding it later would mean touching every call
 * site — which is the cost this seam exists to avoid.
 *
 * TODO(billing): replace the constant with the user's subscription state once
 * Stripe is wired. Everything else in this file, and every caller, stays as is.
 */
export function entitlementsFor(_ctx: TRPCContext): Entitlements {
  return PRO_ENTITLEMENTS;
}

export function isPro(ctx: TRPCContext): boolean {
  return entitlementsFor(ctx).plan === "pro";
}
