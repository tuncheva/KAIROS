/**
 * Billing surface.
 *
 * One query today. It exists as its own router rather than a corner of the agent
 * router because entitlements are not an agent concern — the assistant is simply
 * the first feature to ask — and because this is where checkout, the customer
 * portal and the webhook status will land when Stripe is wired.
 */

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { entitlementsFor } from "~/server/billing/entitlements";

export const billingRouter = createTRPCRouter({
  /**
   * What this user may use.
   *
   * Everything is currently granted — see `billing/entitlements.ts`. The client
   * should still branch on these flags rather than assume, so that turning the
   * constant into a real lookup needs no UI changes. Prefer the `useEntitlements`
   * / `useEntitlement` hooks over calling this query directly: they fail closed
   * while it is in flight, which a bare `data?.flag ?? false` at each call site
   * only does if every call site remembers to.
   */
  entitlements: protectedProcedure.query(({ ctx }) => entitlementsFor(ctx)),
});
