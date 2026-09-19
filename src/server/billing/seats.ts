/**
 * Whether an organization has room for another member — the rule that makes
 * per-seat pricing mean something.
 *
 * Team is sold per seat with a three-seat minimum, and until this module existed
 * `organizations.seats` was written by the webhook, rendered as a warning on the
 * billing screen, and read by nothing that could act on it. Three separate
 * admission paths inserted members without consulting it, so an organization
 * could buy three seats and onboard three hundred people, every one of whom
 * resolved to Team through {@link planForUser}. The seat count was a display
 * field on an invoice.
 *
 * Its own module rather than a helper inside the organization router, for the
 * same reason `~/lib/subscription-status` is not inside `subscriptions.ts`: this
 * is a billing rule that the membership code consumes, and there are three call
 * sites that must not be able to drift from each other. A fourth admission path
 * added later should have exactly one obvious thing to call.
 */

import "server-only";

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  organizations,
  organizationMembers,
} from "~/server/db/schemas/organizations";
import { createLogger } from "~/server/logger";

const log = createLogger("billing:seats");

/**
 * Refuse to admit a member an organization has not paid for.
 *
 * Two deliberate non-enforcements:
 *
 * **A free organization is not seat-limited.** Its members resolve to Free
 * anyway, so there is no entitlement being given away, and capping headcount on
 * the unpaid tier would be a limit that sells nothing — it would only stop
 * people from assembling the team they are meant to later buy Team for.
 *
 * **A non-free plan with no seats on file fails open**, and logs. That state is
 * incoherent — `syncSubscription` writes `plan` and `seats` from the same Stripe
 * object, and `clearSubscription` zeroes both together — so reaching it means a
 * webhook is missing or a row was edited by hand. The safe direction is obvious
 * once named: the cost of failing open is one unpaid seat until someone reads
 * the log, and the cost of failing closed is a paying organization that cannot
 * onboard anyone, with no way for the admin to tell why.
 *
 * Not transactional. Two people accepting invitations in the same instant can
 * both read `count < seats` and both insert, putting the org one over. That is
 * tolerated: the overage is bounded by concurrency rather than unbounded by
 * design, the billing screen surfaces it, and serialising every join behind a
 * row lock to close a one-seat window would be the more expensive mistake.
 *
 * @throws TRPCError FORBIDDEN when every paid seat is occupied.
 */
export async function assertSeatAvailable(organizationId: number): Promise<void> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { plan: true, seats: true },
  });

  if (!org || org.plan === "free") return;

  if (org.seats <= 0) {
    log.error("paid organization has no seats on file; admitting anyway", {
      organizationId,
      plan: org.plan,
    });
    return;
  }

  const members = await db.$count(
    organizationMembers,
    eq(organizationMembers.organizationId, organizationId),
  );

  if (members < org.seats) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    // Addressed to the person who can fix it, even though it is read by the
    // person who cannot. "You may not join" invites them to retry; naming the
    // seat count and the admin tells them what to go and ask for.
    message: `This organization has filled all ${String(org.seats)} of its seats. An admin can add one from Settings → Billing, then you can join.`,
  });
}
