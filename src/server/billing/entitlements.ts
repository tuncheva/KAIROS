/**
 * What a user is entitled to — the server's answer.
 *
 * This is the binding from a caller to a plan, which is the part that needs a
 * session and a database. What each plan *grants* lives in `~/lib/entitlements`
 * — pure, importable from client components, and the single definition of "free"
 * that both sides read.
 *
 * ## Two subscriptions, one answer
 *
 * A person can be covered twice: by their own Pro subscription, and by the Team
 * subscription their organization pays for. Neither knows about the other, and
 * neither should — so the resolver reads both and takes whichever grants more
 * (`higherPlan`). The alternative, a precedence rule, has to be re-argued every
 * time someone joins an org while holding a personal plan.
 *
 * The org half is gated on **membership**, not on `users.activeOrganizationId`
 * alone. That column carries no foreign key, so a stale value left behind by
 * leaving an organization would otherwise hand out Team to someone who is no
 * longer in it.
 *
 * ## It is async now, and that is the whole cost of billing
 *
 * This used to be a synchronous constant. Every call site awaits it today. That
 * was the change the seam existed to contain, and containing it is the reason
 * nothing above this file had to learn what Stripe is.
 *
 * Resolution is memoised per request against the context object, so the several
 * call sites a single AI turn passes through — the rate limiter, the schedule
 * allowance, the history cull — cost one round trip between them rather than one
 * each.
 */

import "server-only";

import { and, eq } from "drizzle-orm";

import {
  entitlementsForPlan,
  higherPlan,
  FREE_ENTITLEMENTS,
  type Entitlements,
  type PlanId,
} from "~/lib/entitlements";
import { db } from "~/server/db";
import { users } from "~/server/db/schemas/users";
import {
  organizations,
  organizationMembers,
} from "~/server/db/schemas/organizations";
import type { TRPCContext } from "~/server/api/trpc";

export type { Entitlements, ExportFormat, PlanId } from "~/lib/entitlements";

/**
 * How long a lapsed period still counts.
 *
 * `currentPeriodEnd` is a backstop, not the primary check — Stripe's webhooks
 * are. It exists for the case where a renewal succeeded and its webhook never
 * arrived, and in that case the subscriber has paid and simply looks expired to
 * us. Three days is long enough to survive a delivery outage and short enough
 * that a genuinely dead subscription does not linger for a billing cycle.
 *
 * It only ever *extends* access. A cancellation that Stripe told us about
 * clears `plan` outright and never reaches this check.
 */
const PERIOD_END_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The plan a stored row still justifies.
 *
 * `plan` is already the writer's verdict — `~/server/billing/subscriptions`
 * decides that `past_due` keeps its tier and `incomplete` does not. This adds
 * only the time check, which is the one thing no webhook can tell us: that
 * nothing has arrived for longer than a paid period.
 *
 * Exported because the billing screen has to agree with it. Reading the `plan`
 * column straight out of the row, as `billing.summary` used to, renders "Pro —
 * renews on «a date last month»" to someone this resolver has already dropped to
 * Free. One rule, both readers.
 */
export function livePlan(plan: PlanId, currentPeriodEnd: Date | null): PlanId {
  if (plan === "free") return "free";
  if (
    currentPeriodEnd &&
    currentPeriodEnd.getTime() + PERIOD_END_GRACE_MS < Date.now()
  ) {
    return "free";
  }
  return plan;
}

/**
 * Resolve the plan for a user id, reading both possible subscriptions.
 *
 * Exported because two call sites have no `TRPCContext` worth building: the
 * history cull resolves a retention window per user inside a sweep, and the
 * scheduled runner resolves an allowance per user inside a loop. Handing those a
 * synthesised context was already awkward when this was synchronous; now that it
 * hits the database, a context whose only real field is a user id is a lie worth
 * not telling.
 */
export async function planForUser(userId: string): Promise<PlanId> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      plan: true,
      currentPeriodEnd: true,
      activeOrganizationId: true,
    },
  });

  if (!user) return "free";

  const personal = livePlan(user.plan, user.currentPeriodEnd);

  if (!user.activeOrganizationId) return personal;

  // Joined through the membership table on purpose — see the file docblock.
  const [org] = await db
    .select({
      plan: organizations.plan,
      currentPeriodEnd: organizations.currentPeriodEnd,
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
    .limit(1);

  if (!org) return personal;

  return higherPlan(personal, livePlan(org.plan, org.currentPeriodEnd));
}

/** {@link planForUser}, as the flag set. */
export async function entitlementsForUser(userId: string): Promise<Entitlements> {
  return entitlementsForPlan(await planForUser(userId));
}

/**
 * Per-request memo.
 *
 * Keyed on the context object, which tRPC creates once per request, so entries
 * become collectable the moment the request is done — no TTL to tune and no way
 * for a plan change to be served from a cache that outlives the request it was
 * read in. A `WeakMap` rather than a `Map` because the alternative pins every
 * request context in memory for the lifetime of the process.
 *
 * The *promise* is cached rather than its result, so two concurrent call sites
 * in the same request share one query instead of racing into two.
 */
const byContext = new WeakMap<object, Promise<Entitlements>>();

/**
 * Resolve what this caller may use.
 *
 * Returns the Free set for an unauthenticated context rather than throwing:
 * callers gate features with it, and a caller with no session has no features to
 * gate. Every `protectedProcedure` has already rejected that case before this is
 * reached.
 */
export function entitlementsFor(ctx: TRPCContext): Promise<Entitlements> {
  const userId = ctx.session?.user?.id;
  if (!userId) return Promise.resolve(FREE_ENTITLEMENTS);

  const cached = byContext.get(ctx);
  if (cached) return cached;

  const pending = entitlementsForUser(userId);
  byContext.set(ctx, pending);
  return pending;
}

export async function isPro(ctx: TRPCContext): Promise<boolean> {
  return (await entitlementsFor(ctx)).plan !== "free";
}
