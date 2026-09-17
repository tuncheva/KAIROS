/**
 * Billing surface — entitlements, checkout and the customer portal.
 *
 * Its own router rather than a corner of the agent router because entitlements
 * are not an agent concern; the assistant is simply the first feature to ask.
 *
 * **Nothing here charges anyone.** Both mutations hand back a Stripe-hosted URL
 * and stop. No card details reach this server, no payment intent is confirmed
 * here, and the grant of a plan happens only in the webhook — which means a user
 * who abandons a checkout page, or closes the tab after paying, converges on the
 * right state either way. A mutation that both redirected *and* wrote the plan
 * would be the version that grants Pro to anyone who can call it.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { entitlementsFor } from "~/server/billing/entitlements";
import {
  absoluteUrl,
  isBillingConfigured,
  isPlanPurchasable,
  priceIdFor,
  stripe,
} from "~/server/billing/stripe";
import {
  billingStateOf,
  isLiveSubscription,
  type BillingOwner,
} from "~/server/billing/subscriptions";
import { organizations, organizationMembers } from "~/server/db/schemas/organizations";
import { users } from "~/server/db/schemas/users";
import { PLAN_CATALOGUE, PURCHASABLE_PLANS } from "~/lib/plans";
import { createLogger } from "~/server/logger";

const log = createLogger("billing:router");

const planInput = z.enum(PURCHASABLE_PLANS);
const intervalInput = z.enum(["month", "year"]).default("month");

/**
 * Where Stripe sends the customer back to.
 *
 * `checkout=success` is a *hint to the UI*, not a grant — it tells the client to
 * invalidate its entitlements query and show a confirmation. The plan itself
 * arrives by webhook, which is why the success screen has to tolerate landing a
 * second before the subscription does.
 */
const RETURN_TO = "/settings?section=billing";

export const billingRouter = createTRPCRouter({
  /**
   * What this user may use.
   *
   * Prefer the `useEntitlements` / `useEntitlement` hooks over calling this
   * query directly: they fail closed while it is in flight, which a bare
   * `data?.flag ?? false` at each call site only does if every call site
   * remembers to.
   */
  entitlements: protectedProcedure.query(({ ctx }) => entitlementsFor(ctx)),

  /**
   * Everything the billing screen renders in one round trip.
   *
   * Deliberately more than `entitlements` returns. The flag set answers "what
   * may I do"; this answers "what am I paying for, until when, and what can I
   * change about it" — which needs the subscription's own state, the seat count,
   * and whether this deployment can sell anything at all.
   */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        plan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        stripeCustomerId: true,
        activeOrganizationId: true,
      },
    });

    const org = user?.activeOrganizationId
      ? (
          await ctx.db
            .select({
              id: organizations.id,
              name: organizations.name,
              plan: organizations.plan,
              subscriptionStatus: organizations.subscriptionStatus,
              currentPeriodEnd: organizations.currentPeriodEnd,
              cancelAtPeriodEnd: organizations.cancelAtPeriodEnd,
              seats: organizations.seats,
              stripeCustomerId: organizations.stripeCustomerId,
              role: organizationMembers.role,
              memberCount: ctx.db.$count(
                organizationMembers,
                eq(organizationMembers.organizationId, organizations.id),
              ),
            })
            .from(organizations)
            .innerJoin(
              organizationMembers,
              and(
                eq(organizationMembers.organizationId, organizations.id),
                eq(organizationMembers.userId, userId),
              ),
            )
            .where(eq(organizations.id, user.activeOrganizationId))
            .limit(1)
        )[0]
      : undefined;

    return {
      /** The plan actually in force — the better of personal and org. */
      effective: await entitlementsFor(ctx),
      personal: {
        plan: user?.plan ?? "free",
        status: user?.subscriptionStatus ?? null,
        currentPeriodEnd: user?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: user?.cancelAtPeriodEnd ?? false,
        /** Whether there is a Stripe customer to open a portal for. */
        manageable: Boolean(user?.stripeCustomerId),
      },
      organization: org
        ? {
            id: org.id,
            name: org.name,
            plan: org.plan,
            status: org.subscriptionStatus,
            currentPeriodEnd: org.currentPeriodEnd,
            cancelAtPeriodEnd: org.cancelAtPeriodEnd,
            seats: org.seats,
            memberCount: org.memberCount,
            /**
             * Only admins may buy or manage seats. Surfaced rather than merely
             * enforced, so a member sees "ask an admin" instead of a button that
             * returns FORBIDDEN.
             */
            canManage: org.role === "admin",
            manageable: Boolean(org.stripeCustomerId),
          }
        : null,
      /** Per-plan, because a deployment may have configured one price and not the other. */
      purchasable: Object.fromEntries(
        PURCHASABLE_PLANS.map((plan) => [plan, isPlanPurchasable(plan)]),
      ) as Record<(typeof PURCHASABLE_PLANS)[number], boolean>,
    };
  }),

  /**
   * Start a checkout and return the URL to send the browser to.
   *
   * Seats are only meaningful for Team; Pro is one person by definition and its
   * quantity is forced to 1 rather than trusted from the client, because a
   * `seats: 0` would produce a €0 subscription that still grants the plan.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        plan: planInput,
        interval: intervalInput,
        /** Required for Team, ignored for Pro. */
        organizationId: z.number().int().optional(),
        seats: z.number().int().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = stripe();
      if (!client || !isBillingConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Billing is not configured for this deployment.",
        });
      }

      const priceId = priceIdFor(input.plan, input.interval);
      if (!priceId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The ${input.plan} plan is not available on a ${input.interval}ly interval.`,
        });
      }

      const descriptor = PLAN_CATALOGUE[input.plan];
      const userId = ctx.session.user.id;

      const { owner, customerId, quantity } = descriptor.perOrganization
        ? await resolveOrgOwner(ctx, userId, input.organizationId, input.seats, descriptor.minimumSeats)
        : await resolvePersonalOwner(ctx, userId);

      // A second checkout for an owner who already has a live subscription
      // creates a second one: Stripe bills both, and the webhook's single
      // `stripeSubscriptionId` column can only remember the newer, leaving the
      // older charging a card forever with nothing in this app pointing at it.
      // The UI already hides the button — this is the same rule on the mutation,
      // which is where it matters, because the client-side version is a hint and
      // this one is the guarantee. It is also the concurrency guard: two admins
      // reaching Team checkout at once is the realistic way this happens.
      //
      // Every change to a live subscription — interval, seats, tier, card —
      // belongs in the billing portal, which prorates. Checkout does not.
      const existing = await billingStateOf(owner);
      if (isLiveSubscription(existing.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            owner.kind === "organization"
              ? "This organization already has a subscription. Change it from the billing portal."
              : "You already have a subscription. Change it from the billing portal.",
        });
      }

      const session = await client.checkout.sessions.create({
        mode: "subscription",

        // Seats are adjustable on Stripe's own page for Team, so a buyer who
        // miscounts can fix it there rather than backing out to this app. Pro is
        // fixed at one: it is a personal plan, and an adjustable quantity would
        // present "how many of you are there?" to a single user.
        line_items: [
          descriptor.perOrganization
            ? {
                price: priceId,
                quantity,
                adjustable_quantity: {
                  enabled: true,
                  minimum: descriptor.minimumSeats,
                  maximum: 500,
                },
              }
            : { price: priceId, quantity },
        ],

        // An existing customer is reused; otherwise Stripe makes one and we
        // record it from the webhook. Passing both `customer` and
        // `customer_email` is an error, hence the branch.
        ...(customerId
          ? { customer: customerId }
          : { customer_email: ctx.session.user.email ?? undefined }),

        // Stamped on the subscription, not just the session. The session's
        // metadata is not copied onto the subscription automatically, and the
        // subscription is what every later webhook carries — without this,
        // `customer.subscription.updated` two months from now has no way back to
        // a row. See `ownerFromMetadata`.
        subscription_data: {
          metadata: {
            kairosOwnerKind: owner.kind,
            kairosOwnerId: String(owner.id),
          },
        },
        metadata: {
          kairosOwnerKind: owner.kind,
          kairosOwnerId: String(owner.id),
        },

        success_url: absoluteUrl(`${RETURN_TO}&checkout=success`),
        cancel_url: absoluteUrl(`${RETURN_TO}&checkout=cancelled`),

        allow_promotion_codes: true,
        // Required for EU VAT on a euro-priced subscription sold to businesses.
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
      });

      if (!session.url) {
        // Stripe returns a session without a URL only in states we do not use
        // (an embedded ui_mode). Treated as a bug rather than passed on as a
        // null the client has to handle.
        log.error("checkout session had no url", { sessionId: session.id });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not start checkout.",
        });
      }

      log.info("checkout session created", {
        ownerKind: owner.kind,
        ownerId: String(owner.id),
        plan: input.plan,
        interval: input.interval,
        quantity,
      });

      return { url: session.url };
    }),

  /**
   * Open the Stripe billing portal — the one place a subscription is changed.
   *
   * Cancelling, updating a card, downloading invoices and changing seats all
   * live there rather than being rebuilt here. That is not laziness: each of
   * those is a regulated flow with dunning, proration and receipt requirements,
   * and a half-built local version of it is how a customer cancels and keeps
   * being charged.
   */
  createPortalSession: protectedProcedure
    .input(
      z.object({
        /** Omitted for a personal subscription; given to manage an org's. */
        organizationId: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = stripe();
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Billing is not configured for this deployment.",
        });
      }

      const customerId = input.organizationId
        ? (await requireOrgAdmin(ctx, ctx.session.user.id, input.organizationId))
            .stripeCustomerId
        : (
            await ctx.db.query.users.findFirst({
              where: eq(users.id, ctx.session.user.id),
              columns: { stripeCustomerId: true },
            })
          )?.stripeCustomerId;

      if (!customerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "There is no subscription to manage yet.",
        });
      }

      const session = await client.billingPortal.sessions.create({
        customer: customerId,
        return_url: absoluteUrl(RETURN_TO),
      });

      return { url: session.url };
    }),
});

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

type Ctx = Parameters<typeof entitlementsFor>[0];

interface ResolvedOwner {
  owner: BillingOwner;
  customerId: string | null;
  quantity: number;
}

async function resolvePersonalOwner(ctx: Ctx, userId: string): Promise<ResolvedOwner> {
  const user = await ctx.db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { stripeCustomerId: true },
  });

  return {
    owner: { kind: "user", id: userId },
    customerId: user?.stripeCustomerId ?? null,
    // Not client-supplied. A personal plan covers one person, and accepting a
    // quantity here would let a caller buy themselves 500 seats of Pro.
    quantity: 1,
  };
}

async function resolveOrgOwner(
  ctx: Ctx,
  userId: string,
  organizationId: number | undefined,
  requestedSeats: number | undefined,
  minimumSeats: number,
): Promise<ResolvedOwner> {
  if (!organizationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Team is bought for an organization; none was named.",
    });
  }

  const org = await requireOrgAdmin(ctx, userId, organizationId);

  // The floor is applied here rather than trusted from the client, and it is a
  // floor rather than a validation error: someone who asks for two seats meant
  // to buy Team, and refusing them is worse than charging the advertised minimum
  // they can see on the pricing page.
  const quantity = Math.max(requestedSeats ?? org.memberCount, minimumSeats);

  return {
    owner: { kind: "organization", id: organizationId },
    customerId: org.stripeCustomerId,
    quantity,
  };
}

/**
 * The organization, if the caller administers it.
 *
 * Membership alone is not enough. Anyone in an org could otherwise start a
 * checkout that bills the org's saved card, or open a portal session that
 * exposes its invoices — both are admin-only facts.
 */
async function requireOrgAdmin(ctx: Ctx, userId: string, organizationId: number) {
  const [row] = await ctx.db
    .select({
      stripeCustomerId: organizations.stripeCustomerId,
      role: organizationMembers.role,
      memberCount: ctx.db.$count(
        organizationMembers,
        eq(organizationMembers.organizationId, organizations.id),
      ),
    })
    .from(organizations)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, organizations.id),
        eq(organizationMembers.userId, userId),
      ),
    )
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!row) {
    // NOT_FOUND rather than FORBIDDEN: to someone who is not a member, an
    // organization they cannot see should not be confirmed to exist.
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
  }

  if (row.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an organization admin can manage its subscription.",
    });
  }

  return row;
}
