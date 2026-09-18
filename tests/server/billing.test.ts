/**
 * Billing: the two decisions that cost money if they are wrong.
 *
 * Deliberately narrow. There is no value in asserting that the Stripe SDK works,
 * and an integration test against a real account belongs in
 * `vitest.integration.config.ts`, not here. What these cover is the logic this
 * codebase actually owns:
 *
 * - **Which statuses still entitle a subscriber**, which is the difference
 *   between a declined card producing a dunning email and it producing a
 *   support ticket from someone whose schedules stopped firing.
 * - **The price catalogue**, because the numbers are quoted on a public page and
 *   then charged through Stripe, and a mismatch between what the page promises
 *   and what the price id bills is the kind of bug that arrives as a chargeback.
 *
 * `planFromSubscription` is imported from `~/lib/subscription-status` rather than
 * from `~/server/billing/subscriptions`, which re-exports it. Not a style
 * preference: the server module imports `~/server/db`, which reads
 * `env.DATABASE_URL` at import time, which throws under this suite's jsdom
 * environment. Importing it there made the whole file fail to collect — vitest
 * reported `billing.test.ts (0 test)` and every assertion below silently never
 * ran. The rule has one definition; only the import path moved.
 */

import { describe, expect, it } from "vitest";

import {
  PLAN_CATALOGUE,
  PURCHASABLE_PLANS,
  annualSavingPercent,
  formatEuro,
  isPurchasablePlan,
  priceFor,
} from "~/lib/plans";
import {
  accessEndsAt,
  isLiveSubscription,
  planFromSubscription,
  willNotRenew,
} from "~/lib/subscription-status";

describe("planFromSubscription", () => {
  it("entitles an active or trialing subscriber", () => {
    expect(planFromSubscription("active", "pro")).toBe("pro");
    expect(planFromSubscription("trialing", "pro")).toBe("pro");
    expect(planFromSubscription("active", "team")).toBe("team");
  });

  it("keeps the plan while a payment is being retried", () => {
    // The deliberate leniency. Stripe retries a declined card for days and most
    // retries succeed; revoking on the first failure punishes an expired card
    // with a downgrade the subscriber never asked for.
    expect(planFromSubscription("past_due", "pro")).toBe("pro");
    expect(planFromSubscription("past_due", "team")).toBe("team");
  });

  it("grants nothing before the first payment succeeds", () => {
    // `incomplete` means the initial charge has not gone through. Treating it as
    // entitled would hand out the plan to anyone who reaches the card page and
    // abandons it.
    expect(planFromSubscription("incomplete", "pro")).toBe("free");
  });

  it("revokes on cancellation", () => {
    expect(planFromSubscription("canceled", "pro")).toBe("free");
    expect(planFromSubscription("canceled", "team")).toBe("free");
  });

  it("returns free when the price matched no known plan", () => {
    // `planFromPriceId` answers null for a price this deployment does not
    // recognise — a subscription created against a different environment's
    // price, say. Falling back to free is the only safe direction: the
    // alternative is guessing a tier from an id we cannot interpret.
    expect(planFromSubscription("active", null)).toBe("free");
  });
});

describe("isLiveSubscription", () => {
  it("counts anything Stripe is still collecting on", () => {
    // The guard that stops a second checkout from double-billing. `past_due` is
    // live for this purpose too: the card is being retried, and a second
    // subscription started during dunning bills alongside the first.
    expect(isLiveSubscription("active")).toBe(true);
    expect(isLiveSubscription("trialing")).toBe(true);
    expect(isLiveSubscription("past_due")).toBe(true);
  });

  it("does not block checkout after a cancellation", () => {
    // Someone who cancelled must be able to buy again — this is the ordinary
    // resubscribe path, and treating it as a double purchase would leave them
    // with no way back other than support.
    expect(isLiveSubscription("canceled")).toBe(false);
    expect(isLiveSubscription(null)).toBe(false);
  });

  it("does not block the retry of a checkout that never completed", () => {
    // `incomplete` means the first payment failed. There is nothing to
    // double-bill, and blocking here would strand a user whose card was declined
    // once behind a portal that has no subscription to show them.
    expect(isLiveSubscription("incomplete")).toBe(false);
  });

  it("grants nothing it would not also block on, and vice versa", () => {
    // The two rules coincide today but answer different questions, so they are
    // written separately. This pins the overlap: anything that grants a plan
    // must also block a second purchase, or an entitled user could buy twice.
    const statuses = [
      "active",
      "trialing",
      "past_due",
      "canceled",
      "incomplete",
    ] as const;

    for (const status of statuses) {
      if (planFromSubscription(status, "pro") !== "free") {
        expect(isLiveSubscription(status), status).toBe(true);
      }
    }
  });
});

describe("willNotRenew", () => {
  // Regression: a cancellation made in Stripe's billing portal sets `cancel_at`
  // and leaves `cancel_at_period_end` false. Reading only the boolean showed a
  // cancelled subscriber "Renews on <the date it ends>" — found by cancelling a
  // real sandbox subscription, which is why it is pinned here.
  it("sees a portal cancellation that only sets cancel_at", () => {
    expect(willNotRenew({ cancel_at_period_end: false, cancel_at: 1792311321 })).toBe(
      true,
    );
  });

  it("still sees the legacy boolean", () => {
    expect(willNotRenew({ cancel_at_period_end: true, cancel_at: null })).toBe(true);
  });

  it("leaves a renewing subscription alone", () => {
    expect(willNotRenew({ cancel_at_period_end: false, cancel_at: null })).toBe(false);
  });
});

describe("accessEndsAt", () => {
  it("uses the period end while the subscription renews", () => {
    expect(
      accessEndsAt({
        current_period_end: 2000,
        cancel_at: null,
        cancel_at_period_end: false,
      }),
    ).toBe(2000);
  });

  it("uses the cancellation date when it falls first", () => {
    // `cancel_at` can name any date, not only a period boundary — a mid-period
    // cancellation ends access before the period does.
    expect(
      accessEndsAt({
        current_period_end: 2000,
        cancel_at: 1500,
        cancel_at_period_end: false,
      }),
    ).toBe(1500);
  });

  it("keeps the period end when the cancellation is later", () => {
    expect(
      accessEndsAt({
        current_period_end: 2000,
        cancel_at: 3000,
        cancel_at_period_end: false,
      }),
    ).toBe(2000);
  });

  it("survives a subscription with neither", () => {
    // Null means "no known end", which the resolver reads as "do not expire on
    // time alone" — the webhooks remain the primary signal.
    expect(
      accessEndsAt({
        current_period_end: null,
        cancel_at: null,
        cancel_at_period_end: false,
      }),
    ).toBeNull();
  });
});

describe("the price catalogue", () => {
  it("prices every purchasable plan on both intervals", () => {
    for (const plan of PURCHASABLE_PLANS) {
      expect(PLAN_CATALOGUE[plan].pricing, plan).not.toBeNull();
      expect(priceFor(plan, "month"), `${plan} monthly`).toBeGreaterThan(0);
      expect(priceFor(plan, "year"), `${plan} annual`).toBeGreaterThan(0);
    }
  });

  it("leaves Free without a price rather than pricing it at zero", () => {
    // Null and 0 render differently and mean different things: one is "this tier
    // has no price", the other is "this tier costs €0.00", and the second invites
    // a checkout button.
    expect(PLAN_CATALOGUE.free.pricing).toBeNull();
  });

  it("makes a year cheaper than twelve months", () => {
    for (const plan of PURCHASABLE_PLANS) {
      expect(priceFor(plan, "year"), plan).toBeLessThan(
        priceFor(plan, "month") * 12,
      );
      // The memo's offer is two months free. Asserted as a range rather than an
      // exact figure so a deliberate change to the discount does not fail, but
      // an accidental inversion of the two prices does.
      expect(annualSavingPercent(plan), plan).toBeGreaterThan(10);
      expect(annualSavingPercent(plan), plan).toBeLessThan(25);
    }
  });

  it("prices Team above Pro", () => {
    expect(priceFor("team", "month")).toBeGreaterThan(priceFor("pro", "month"));
  });

  it("requires more than one seat for Team and exactly one for Pro", () => {
    // Team sold to a single person is a Pro subscription at twice the price.
    expect(PLAN_CATALOGUE.team.minimumSeats).toBeGreaterThan(1);
    expect(PLAN_CATALOGUE.pro.minimumSeats).toBe(1);
  });

  it("bills Team to an organization and Pro to a person", () => {
    expect(PLAN_CATALOGUE.team.perOrganization).toBe(true);
    expect(PLAN_CATALOGUE.pro.perOrganization).toBe(false);
    expect(PLAN_CATALOGUE.free.perOrganization).toBe(false);
  });

  it("does not admit free as something to check out", () => {
    expect(isPurchasablePlan("free")).toBe(false);
    expect(isPurchasablePlan("pro")).toBe(true);
    expect(isPurchasablePlan("team")).toBe(true);
    expect(isPurchasablePlan("enterprise")).toBe(false);
  });

  it("renders whole euros without trailing cents", () => {
    expect(formatEuro(1200)).toBe("€12");
    expect(formatEuro(1250)).toBe("€12.50");
    expect(formatEuro(0)).toBe("€0");
  });
});
