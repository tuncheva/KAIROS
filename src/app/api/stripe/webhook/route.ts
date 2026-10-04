/**
 * Stripe webhook — the only place a plan is granted or revoked.
 *
 * Checkout returns the customer to the app, but the *redirect is not the
 * payment*. A user can close the tab before it fires, a card can be declined
 * three days later, a subscription can be cancelled from the Stripe dashboard by
 * someone who never opens this app at all. Every one of those has to move the
 * plan, and only this route hears about them — which is why
 * `billing.createCheckoutSession` deliberately writes nothing.
 *
 * ## Three things this route must get right
 *
 * 1. **Verify the signature.** The handler mutates subscription state purely on
 *    the strength of its request body. An unverified POST here is a free Pro
 *    subscription for anyone who can reach the URL. There is no development
 *    bypass, and there must never be one.
 * 2. **Read the raw body.** `constructEvent` verifies a signature over the exact
 *    bytes Stripe sent. `await req.json()` re-serialises — different whitespace,
 *    different key order — and every delivery then fails verification.
 * 3. **Answer 2xx quickly, even for events it ignores.** Stripe retries anything
 *    else with exponential backoff for up to three days, and a 500 on an event
 *    this app does not care about eventually disables the endpoint.
 */

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { stripe } from "~/server/billing/stripe";
import {
  billingStateOf,
  clearSubscriptionIfCurrent,
  customerIdOf,
  ownerFromMetadata,
  ownerFromSubscriptionId,
  rememberCustomer,
  syncSubscription,
  type BillingOwner,
} from "~/server/billing/subscriptions";
import { env } from "~/env";
import { db } from "~/server/db";
import { organizations } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { notify, type NotificationCategory } from "~/server/notifications/dispatch";

const log = createLogger("billing:webhook");

/**
 * Node, not Edge.
 *
 * Stripe's signature verification uses Node's crypto primitives, and the SDK's
 * default `constructEvent` is synchronous in a way the Edge runtime cannot
 * support. (`constructEventAsync` exists for Edge; the Node runtime is the
 * simpler correct answer while every other route here is already Node.)
 */
export const runtime = "nodejs";

/**
 * Never cached, never statically analysed into a build-time fetch.
 *
 * A cached webhook is a webhook that silently stops processing payments.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const client = stripe();
  const secret = env.STRIPE_WEBHOOK_SECRET;

  if (!client || !secret) {
    // 503 rather than 404: the endpoint exists and is simply not configured, and
    // Stripe's dashboard should show it as failing rather than as a bad URL.
    log.error("webhook received but Stripe is not configured");
    return new Response("Billing is not configured", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  // The exact bytes Stripe signed — see the file docblock.
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = client.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    // 400, deliberately. Stripe does not retry a 4xx, and it should not: a
    // signature that does not verify will not verify on the second attempt
    // either, and retrying it only delays noticing the misconfiguration.
    log.warn("webhook signature verification failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    await handle(event, client);
  } catch (err) {
    // Not every failure is worth retrying, and the difference matters more here
    // than it looks. Stripe retries a 500 with backoff for three days and then
    // *disables the endpoint* — so one event that can never succeed does not
    // fail one subscription, it eventually takes down billing for everybody.
    // That is a strictly worse outcome than dropping the event, especially now
    // that `~/server/billing/reconcile` re-reads Stripe hourly and repairs
    // whatever a dropped event would have written.
    const reason = permanentFailure(err, event);
    if (reason) {
      log.error("dropping a webhook event that cannot succeed on a retry", {
        type: event.type,
        eventId: event.id,
        reason,
        err,
      });
      return new Response(null, { status: 204 });
    }

    // 500 so Stripe retries. This is the case where a retry genuinely helps: the
    // signature was good, the event is real, and the failure is ours and
    // probably transient — a database that was briefly unreachable. Every
    // handler below is idempotent for exactly this reason.
    log.error("webhook handler failed", {
      type: event.type,
      eventId: event.id,
      err,
    });
    return new Response("Handler failed", { status: 500 });
  }

  return new Response(null, { status: 204 });
}

/**
 * How long an event is worth retrying before it is written off.
 *
 * Shorter than Stripe's own three days on purpose. Past this point the retries
 * are no longer plausibly going to succeed, and the reconciliation sweep will
 * have run two dozen times — so continuing to fail them only risks the endpoint
 * being disabled for a repair that has already happened by another route.
 */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a failure will still be a failure on the next delivery.
 *
 * Two kinds qualify. A constraint violation is a statement about the data, not
 * about the moment — the unique indexes on `stripe_customer_id` and
 * `stripe_subscription_id` will reject the same row just as firmly in an hour.
 * And an event old enough to have exhausted a day of retries has demonstrated
 * the point empirically, whatever the cause.
 *
 * Returns the reason rather than a boolean so the log says which it was; that is
 * the difference between "we have a data problem" and "we had an outage".
 */
function permanentFailure(err: unknown, event: Stripe.Event): string | null {
  // Postgres SQLSTATE classes that describe the data rather than the connection.
  // The `postgres` driver surfaces them on `.code`.
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^(23|22)/.test(code)) {
    return `constraint violation ${code}`;
  }

  const ageMs = Date.now() - event.created * 1000;
  if (ageMs > MAX_EVENT_AGE_MS) {
    return `event is ${Math.round(ageMs / 3_600_000)}h old`;
  }

  return null;
}

/**
 * Dispatch.
 *
 * The unhandled case returns quietly rather than erroring. A Stripe account
 * sends a great many event types, most of which say nothing about entitlement,
 * and treating "I do not care about this" as a failure is what turns an
 * unrelated dashboard action into a retry storm.
 */
async function handle(event: Stripe.Event, client: Stripe): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      // Records the customer id against the owner immediately, so a second
      // checkout or a trip to the portal reuses the customer rather than
      // creating a duplicate. Done here rather than waiting for the
      // subscription events because this is the first event that reliably
      // carries both the customer and our metadata.
      const owner = ownerFromMetadata(session.metadata);
      const customerId = customerIdOf(session.customer);
      if (owner && customerId) {
        await rememberCustomer(owner, customerId);
      }

      // The session carries a subscription id, not the subscription. Re-reading
      // it rather than trusting the session's summary means the plan, seat count
      // and period end all come from one object that is authoritative about all
      // three.
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;

      if (subscriptionId) {
        const subscription = await client.subscriptions.retrieve(subscriptionId);
        await syncSubscription(subscription, owner);
      }
      return;
    }

    // Created, updated and the trial notice all mean the same thing to us:
    // re-read the object and write what it says. Distinguishing them would mean
    // three handlers that must agree, to produce one outcome.
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.trial_will_end": {
      const owner = await syncSubscription(event.data.object);

      // The trial notice is the one of the three a person needs to hear about.
      // After the sync, so the billing screen the link opens already agrees.
      if (event.type === "customer.subscription.trial_will_end" && owner) {
        const trialEnd = event.data.object.trial_end;
        const days =
          typeof trialEnd === "number"
            ? Math.max(1, Math.ceil((trialEnd * 1000 - Date.now()) / 86_400_000))
            : null;
        await notifyBillingOwner(owner, {
          category: "workspace",
          title: "Your trial is ending",
          message: (subject) =>
            `${subject} trial ends ${days === null ? "soon" : `in ${days} day${days === 1 ? "" : "s"}`}. Add a payment method to keep your plan.`,
        });
      }
      return;
    }

    case "customer.subscription.deleted": {
      // Clearing rather than syncing, because this is the one event where
      // Stripe's object still describes the plan that just ended — and guarded
      // on the subscription id, because a late `deleted` for a subscription the
      // owner has already replaced would revoke a plan they are paying for.
      //
      // Whether it *was* current is read before clearing, so the notice goes out
      // only when a plan actually ended — not for a superseded subscription, and
      // not a second time when Stripe redelivers an event already applied.
      const subscription = event.data.object;
      const owner =
        ownerFromMetadata(subscription.metadata) ??
        (await ownerFromSubscriptionId(subscription.id));
      const wasCurrent = owner
        ? (await billingStateOf(owner)).subscriptionId === subscription.id
        : false;

      await clearSubscriptionIfCurrent(subscription);

      if (owner && wasCurrent) {
        await notifyBillingOwner(owner, {
          category: "workspace",
          title: "Your subscription has ended",
          message: (subject) =>
            `${subject} subscription has ended and the plan is back on Free. You can resubscribe from billing settings.`,
        });
      }
      return;
    }

    // A renewal succeeded or failed. Neither changes the plan by itself — Stripe
    // has already moved the subscription's status and sent an `updated` for it —
    // but re-syncing on payment is what refreshes `currentPeriodEnd`, which is
    // the backstop the resolver falls back on when an `updated` goes missing.
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId = subscriptionIdOf(invoice);
      if (subscriptionId) {
        const subscription = await client.subscriptions.retrieve(subscriptionId);
        const owner = await syncSubscription(subscription);

        // Security, not workspace: a failed charge is about to cost someone
        // their plan, and that must not be something a preference can hide.
        if (event.type === "invoice.payment_failed" && owner) {
          await notifyBillingOwner(owner, {
            category: "security",
            title: "Payment failed",
            message: (subject) =>
              `${subject} latest subscription payment failed. Update your payment method to keep your plan.`,
          });
        }
      }
      return;
    }

    default:
      log.debug("ignoring webhook event", { type: event.type });
  }
}

/**
 * Tell the person who pays.
 *
 * A personal subscription belongs to its user; a Team subscription is addressed
 * to the organization's creator, the account that owns the workspace. Called
 * only after the event's database writes and never throws, so a lost notice
 * cannot turn a delivered event into a 500 and a retry.
 */
async function notifyBillingOwner(
  owner: BillingOwner,
  notice: {
    category: NotificationCategory;
    title: string;
    /** Given "Your" or "The <workspace> workspace's". */
    message: (subject: string) => string;
  },
): Promise<void> {
  try {
    let userId: string;
    let subject = "Your";

    if (owner.kind === "organization") {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, owner.id),
        columns: { createdById: true, name: true },
      });
      if (!org) return;
      userId = org.createdById;
      subject = `The ${org.name} workspace's`;
    } else {
      userId = owner.id;
    }

    await notify({
      db,
      userId,
      category: notice.category,
      type: "system",
      title: notice.title,
      message: notice.message(subject),
      link: "/settings?section=billing",
    });
  } catch (err) {
    // The owner lookup is ours, not `notify`'s, so it gets its own guard: the
    // plan has already been written, and a retry would only re-send the notice.
    log.error("billing notification failed", {
      ownerKind: owner.kind,
      ownerId: String(owner.id),
      err,
    });
  }
}

/**
 * The subscription an invoice belongs to.
 *
 * Stripe moved this off the invoice root and onto its line items' parent, so a
 * direct `invoice.subscription` read returns undefined on current API versions —
 * which would silently skip every renewal and leave `currentPeriodEnd` frozen at
 * whatever the first payment set. Written defensively because it is a field
 * whose location has already changed once.
 */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  for (const line of invoice.lines?.data ?? []) {
    const parent = line.parent;
    const id = parent?.subscription_item_details?.subscription;
    if (typeof id === "string") return id;
  }
  return null;
}
