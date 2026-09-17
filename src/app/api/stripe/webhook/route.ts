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

import type Stripe from "stripe";

import { stripe } from "~/server/billing/stripe";
import {
  clearSubscriptionIfCurrent,
  customerIdOf,
  ownerFromMetadata,
  rememberCustomer,
  syncSubscription,
} from "~/server/billing/subscriptions";
import { env } from "~/env";
import { createLogger } from "~/server/logger";

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
    // 500 so Stripe retries. This is the one case where a retry genuinely helps:
    // the signature was good and the event is real, so the failure is ours —
    // usually the database — and the same event replayed later will land
    // correctly. Every handler below is idempotent for exactly this reason.
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
      await syncSubscription(event.data.object);
      return;
    }

    case "customer.subscription.deleted": {
      // Clearing rather than syncing, because this is the one event where
      // Stripe's object still describes the plan that just ended — and guarded
      // on the subscription id, because a late `deleted` for a subscription the
      // owner has already replaced would revoke a plan they are paying for.
      await clearSubscriptionIfCurrent(event.data.object);
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
        await syncSubscription(subscription);
      }
      return;
    }

    default:
      log.debug("ignoring webhook event", { type: event.type });
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
