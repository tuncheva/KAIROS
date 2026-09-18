/**
 * Seats — the part of a Team subscription that was sold but never enforced.
 *
 * `organizations.seats` records the quantity Stripe is billing for, and until
 * this module existed nothing read it except a warning on the billing screen.
 * Every way into an organization — the access code, a QR code, an emailed invite
 * — inserted a member without asking, and `planForUser` grants the org's plan to
 * *every* member. Three seats therefore bought an unlimited number of Team
 * entitlements, which is the whole revenue model rounded down to zero.
 *
 * ## The invariant
 *
 * On a paid plan, `memberCount <= seats`. It is held from both ends, because
 * either alone is trivially walked around:
 *
 * - **Joining** is refused when the organization is full ({@link seatAvailability}).
 * - **Buying** cannot ask for fewer seats than there are members already —
 *   `seatFloorFor` in `~/lib/plans`. Without this an organization grows to fifty
 *   on the free plan and then buys the three-seat minimum, arriving over the
 *   limit without any single join having crossed it.
 *
 * Free organizations are not capped. That is a product decision rather than an
 * oversight: the free tier is per-person by entitlement, so a large free
 * organization costs nothing and gains nobody anything.
 *
 * ## What this deliberately does not do
 *
 * It never removes anybody. An organization that ends up over its seat count —
 * by a seat reduction in the portal, or by the race below — keeps everyone and
 * shows the admin the gap. Silently revoking a colleague's access to make the
 * arithmetic work is worse than being one seat over.
 *
 * The check is read-then-write rather than a conditional insert, so two people
 * accepting invitations in the same instant can both pass it and land one seat
 * over. That is bounded (it needs simultaneous joins by distinct rate-limited
 * accounts), self-correcting on the next join attempt, and visible on the
 * billing screen — all of which is cheaper than threading a transaction through
 * four unrelated join flows.
 */

import "server-only";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  organizations,
  organizationMembers,
} from "~/server/db/schemas/organizations";
import type { PlanId } from "~/lib/entitlements";
import { livePlan } from "./entitlements";

export interface SeatAvailability {
  /** The plan actually in force, with a lapsed period already accounted for. */
  plan: PlanId;
  /** Seats bought. Zero on a free organization, which is not a limit. */
  seats: number;
  memberCount: number;
  /** Whether one more member may be added. Always true on a free plan. */
  hasRoom: boolean;
}

/**
 * How full an organization is.
 *
 * Reads the plan through `livePlan` for the same reason the billing screen does:
 * an organization whose renewal webhook never arrived is no longer entitled, and
 * enforcing a seat limit derived from a plan the resolver has already withdrawn
 * would lock people out of a workspace that is, as far as entitlements are
 * concerned, back on the uncapped free tier.
 */
export async function seatAvailability(
  organizationId: number,
): Promise<SeatAvailability | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { plan: true, seats: true, currentPeriodEnd: true },
  });

  if (!org) return null;

  const plan = livePlan(org.plan, org.currentPeriodEnd);
  const memberCount = await db.$count(
    organizationMembers,
    eq(organizationMembers.organizationId, organizationId),
  );

  return {
    plan,
    seats: org.seats,
    memberCount,
    hasRoom: plan === "free" || memberCount < org.seats,
  };
}

// The buying half of the invariant is `seatFloorFor` in `~/lib/plans`, next to
// the minimums it reads. It lives there rather than here because it is pure, and
// because everything in this file needs a database — which, as
// `tests/server/billing.test.ts` records the hard way, is what makes a rule
// untestable.
