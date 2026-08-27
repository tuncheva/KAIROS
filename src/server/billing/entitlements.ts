/**
 * What a user is entitled to — the server's answer.
 *
 * KAIROS has no billing yet — no plan column, no payment provider, no
 * subscription lifecycle. This exists so the features that will eventually sit
 * behind a paid tier can be *marked* now, in one place, rather than having the
 * question "is this user paying?" answered ad hoc in a dozen components later.
 *
 * **Nothing is blocked today.** {@link entitlementsFor} returns the Pro set for
 * everyone on purpose: a paywall enforced before there is a way to pay is a
 * paywall that locks the product's own authors out of it, and every call site
 * would have to be revisited to unbreak. Marking is reversible; blocking is not.
 *
 * The flags themselves, and what each plan grants, live in `~/lib/entitlements`
 * — pure, importable from client components, and the single definition of
 * "free" that both sides read. This module is only the binding from a caller to
 * a plan, which is the part that needs a session.
 *
 * When Stripe lands, exactly one function below changes. Call sites do not.
 */

import "server-only";

import { entitlementsForPlan, type Entitlements } from "~/lib/entitlements";
import type { TRPCContext } from "~/server/api/trpc";

export type { Entitlements, ExportFormat, PlanId } from "~/lib/entitlements";

/**
 * Resolve what this caller may use.
 *
 * The `ctx` parameter is unused and deliberately kept: it is the argument the
 * real implementation needs, and adding it later would mean touching every call
 * site — which is the cost this seam exists to avoid.
 *
 * TODO(billing): replace the constant plan with the user's subscription state
 * once Stripe is wired — `entitlementsForPlan(await planFor(ctx))`. Everything
 * else in this file, and every caller, stays as is.
 */
export function entitlementsFor(_ctx: TRPCContext): Entitlements {
  return entitlementsForPlan("pro");
}

export function isPro(ctx: TRPCContext): boolean {
  return entitlementsFor(ctx).plan === "pro";
}
