# Monetisation audit — purchasing, discounts and packaging

**Date:** 19 September 2026
**Scope:** the commercial path only — `lib/plans`, `lib/entitlements`, `lib/subscription-status`, `server/billing/*`, `server/api/routers/billing`, the Stripe webhook, the two pricing surfaces, and the enforcement sites that decide whether a paid feature is actually paid for.
**Basis:** shipped code on `theme/audit-implementation`, read against `docs/business/pricing-strategy.html`.

---

## Summary

The billing *machinery* is in better shape than most products at this stage. Stripe is the source of truth, the webhook is the single grant point, `syncSubscription` is idempotent by construction, `past_due` correctly keeps the plan, the superseded-subscription guard is a subtle bug that someone already thought about, and the checkout mutation refuses to double-bill. None of that needs re-litigating.

The problem is one layer up. **The per-seat business model is not enforced anywhere**, three features sold on the pricing page are reachable without paying, VAT is collected as data and never charged, and the discount surface is wide open. Separately, the highest-converting lever in the product — a trial — is fully plumbed and never pulled.

Ranked by euros:

| # | Finding | Kind | Severity |
|---|---|---|---|
| A1 | Seats are sold, never enforced | Revenue leak | **Critical** |
| A2 | No VAT collected on EU sales | Margin / compliance | **Critical** |
| A3 | Promotion codes enabled unconditionally | Discount leak | **High** |
| A4 | Three paid features have no server-side gate | Revenue leak | **High** |
| C1 | An unmappable price ID silently downgrades a paying customer | Correctness | **High** |
| B1 | No trial, despite complete plumbing | Conversion | **High** |
| B2 | Team is unbuyable without an org, and there is no way to make one | Conversion | **High** |
| B5 | No verified Pro → Team upgrade path | Conversion | **High** |
| B3 | Public pricing page drops purchase intent | Conversion | Medium |
| B4 | The annual discount is under-sold | Conversion | Medium |
| B6 | Advertised request quotas are not what users get | Trust | Medium |
| A5 | Double-billing is possible and never flagged | Trust / churn | Medium |
| C2 | Org dunning is invisible to the admin | Churn | Medium |
| C3 | Half the billing copy is untranslated | Conversion | Medium |

## Status

Fixed in `fix/monetisation-audit-batch-1`: **A1** (seats enforced at all three
admission paths), **A2** (`automatic_tax`, behind `STRIPE_AUTOMATIC_TAX`), **A4**
(gates on `undoApply`, `agentPinning`, `perAgentMemory`, `standingInstructions`),
**B1** (30-day trial, no card), **C1** (`planToRecord` keeps the plan on file
rather than downgrading on an unrecognised price).

`tests/server/entitlementEnforcement.test.ts` now fails the build if a paid flag
loses its server-side gate, and its allowlist is the record of which flags are
deliberately unenforced.

### Checked against the Stripe account (sandbox, `acct_…fE0b`, BG/EUR)

- **A3 — no action needed yet.** The account has **zero coupons and zero
  promotion codes**. `allow_promotion_codes: true` is therefore a policy gap
  rather than a live leak: the rules in A3 should be adopted before the first
  code is created, not retroactively.
- **B5 — confirmed broken.** The default portal configuration has
  `subscription_update.enabled = false`, so the portal offers **no plan
  switching at all**. The checkout mutation's "change it from the billing
  portal" is currently false: a Pro subscriber cannot reach Team without
  cancelling and waiting out the period. Cancellation is correctly
  `at_period_end`, and card update and invoice history are both on.
- **A2 — the prerequisite is not met.** Stripe Tax reports `status: pending`
  with **zero registrations**, which is why `automatic_tax` ships behind an env
  flag defaulting to off. Enabling it before Tax is active would reject every
  checkout session.

Sandbox is not live. Re-check all three against the live account before launch.

Still open: **A3** (adopt the policy), **B5** (enable plan switching in the
portal), **A5**, **B2**, **B3**, **B4**, **B6**, **C2**, **C3**.

---

# A. Revenue leaks

## A1 — Seats are sold but never enforced *(critical)*

Team is priced per seat with a three-seat minimum. `organizations.seats` is written in exactly one place — [`subscriptions.ts:249`](src/server/billing/subscriptions.ts:249), from the Stripe quantity — and read in exactly one place: [`BillingSettingsClient.tsx:249`](src/components/settings/BillingSettingsClient.tsx:249), where it renders a warning row.

Nothing else in the codebase reads it. In particular:

- [`organization.join`](src/server/api/routers/organization.ts:439) rate-limits the access-code guess and checks for an existing membership. It does not check seats.
- [`planForUser`](src/server/billing/entitlements.ts:98) grants the org's plan to **any** confirmed member.

So: buy three seats at €22 (€66/month), share the 12-character access code, and two hundred people hold Team entitlements. The per-seat model is decorative. This is not a theoretical exploit — it is what a customer discovers by accident the first time they onboard faster than they remember to update billing, and once they discover it there is no reason to ever buy a fourth seat.

The `overSeats` warning makes this worse rather than better: it tells the admin they are over, and then nothing happens. A limit that announces itself and does not bind teaches the customer the limit is optional.

**Fix, in order of how much it is worth:**

1. Enforce at the door. In `organization.join` and any invite-accept path, count members against `organizations.seats` when `plan !== "free"` and refuse with a message aimed at the *admin*, not the joiner ("This organization has 3 of 3 seats in use. Ask an admin to add one.").
2. Make the overage self-serve and instant: the over-seat row should be a button that opens the portal with the quantity pre-filled, not a red sentence.
3. Grace, deliberately chosen rather than accidental: allow the org to go over for 7 days and email the admin, then bind. Blocking a new hire's first morning is a support ticket; blocking them a week later is a purchase.
4. Optional, and worth modelling: move Team onto Stripe's automatic quantity updates so headcount and billing cannot drift at all. That removes the enforcement question instead of answering it.

## A2 — No VAT is collected, on a euro-priced EU product *(critical)*

[`billing.ts:265-268`](src/server/api/routers/billing.ts:265) sets `billing_address_collection: "required"` and `tax_id_collection: { enabled: true }` — you collect the address and the VAT number — and then never uses either. There is no `automatic_tax` anywhere in the repo.

The consequence depends on registration status, and both branches are bad:

- **Registered for VAT:** €12 is VAT-inclusive whether you meant it to be or not. At a 20% rate you are keeping €10 and owing €2. That is a fifth of the margin on every subscription, and it compounds at the annual price.
- **Not yet registered:** you are accruing an obligation across EU member states with no record of where the customers were. The OSS threshold arrives quietly.

The pricing page footer already says "exclude VAT" ([`PricingTable.tsx:47`](src/components/marketing/PricingTable.tsx:47)) — which is a promise the checkout does not keep.

**Fix.** Two lines, but they must land together, because with an existing `customer` Stripe rejects `automatic_tax` unless the session is allowed to update the customer record:

```ts
automatic_tax: { enabled: true },
customer_update: customerId ? { address: "auto", name: "auto" } : undefined,
```

Then enable Stripe Tax and register the origin country in the dashboard. Do this before the first live charge, not after — retroactive VAT on issued invoices means re-issuing every one of them.

## A3 — Promotion codes are enabled on every checkout, with no policy *(high)*

[`billing.ts:265`](src/server/api/routers/billing.ts:265) sets `allow_promotion_codes: true` unconditionally — every plan, both intervals, every seat count, forever. There is no allowlist, no per-plan restriction, and no in-app record of which codes exist.

That means the entire discount policy lives in the Stripe dashboard, where:

- a coupon's default duration is **`forever`** unless someone remembers to set `once` or `repeating`;
- a promotion code has **no redemption cap** unless someone sets `max_redemptions`;
- a code created for a conference, a beta cohort or a single unhappy customer works for anyone who types it, on annual Team at 500 seats, for the life of the subscription.

The failure mode is not dramatic: it is one code in one Reddit comment, and a cohort of customers permanently at 50% who never appear in any margin calculation, because the discount lives in Stripe and the pricing lives in the code.

**Fix:**

1. Audit every existing coupon now for `duration`, `max_redemptions` and `expires_at`. Anything `forever` without a deliberate reason should be `repeating` for a named number of months.
2. Establish the rule that all codes are `once` or `repeating` with a redemption cap and an expiry, and write it into `lib/plans.ts` as a comment beside the prices, where the person changing pricing will read it.
3. Consider resolving codes server-side — accept a code in the mutation input, validate it against an allowlist of what may be discounted, and pass `discounts: [{ promotion_code }]` explicitly instead of `allow_promotion_codes`. This also puts the code in your own logs, which `allow_promotion_codes` does not.
4. Turn promotion codes off on annual. The annual price is already a 17% discount; stacking a coupon on it is how a customer ends up paying less than your model cost.

## A4 — Features sold on the pricing page have no server-side gate *(high)*

`server/api/routers/integration.ts` is the model of how this should be done: `assertApiAccess` and `assertDocuments` at fourteen call sites, with a comment explaining why the `await` at each one is load-bearing. The pattern exists and works.

It was not applied to the "Trust and control" family, which is a Pro selling point in both the memo and `PLAN_CATALOGUE`:

| Sold as | Where it lives | Gate |
|---|---|---|
| "Undo, plan diffs and the tool inspector" | [`agent.undoApply`](src/server/api/routers/agent.ts:955) | none — plain `protectedProcedure` |
| "Per-agent memory" | [`memory.ts:225-236`](src/server/llm/memory.ts:225) | none — the limit is chosen by scope, never by plan |
| "Pick a specialist directly" (agent pinning) | agent router | no `entitlements.agentPinning` read anywhere on the server |

A free user who calls `agent.undoApply` over tRPC gets the undo. `entitlements.undoApply` and `entitlements.agentPinning` are read by no server code at all — grep finds zero enforcement sites for either.

This is smaller in euros than A1, but it is the same category of problem: the pricing page makes a claim the server does not keep. It also undermines the memo's own strategy, which is that Pro is worth paying for because of what it *adds* — every unenforced flag is a line on the pricing page that a prospect can discover is free.

**Fix.** Add `assertEntitlement(ctx, "undoApply")` in the same shape as `assertApiAccess`, at the three sites above. Then add a test that walks `Entitlements`' boolean keys and asserts each is read by at least one file under `src/server` — the flag set is the spec, and a flag nothing reads is a feature nobody is paying for.

## A5 — Double-billing is possible and never surfaced *(medium)*

The checkout guard at [`billing.ts:208`](src/server/api/routers/billing.ts:208) prevents a second subscription *per owner*. But personal and organizational subscriptions are different owners, so a user holding personal Pro whose org then buys Team pays €12 **and** €22 and receives `max(pro, team)` — exactly Team, which the €22 alone would have given them.

`billing.summary` returns both subscriptions and the screen renders both, which is the right foundation. The docblock even explains that showing both lets someone "stop paying for the one that is now redundant" — but nothing actually says it is redundant. The user has to derive the entitlement-maximum rule from two rows of a settings page.

This is revenue you keep until the customer notices, and then it is a refund request and a support conversation that opens with "you were charging me twice". Say it plainly: when `personal.plan !== "free"` and the org's plan ranks at or above it, add a row — "Your organization's Team plan already covers everything your personal Pro does. Cancel Pro to stop paying twice." — with the portal button beside it.

---

# B. Conversion gaps

## B1 — There is no trial, and every piece of trial plumbing is already built *(high)*

`trialing` is a value in the `subscription_status` enum, it is handled in `normaliseStatus`, it grants in `planFromSubscription`, and it counts as live in `isLiveSubscription`. Every branch is written and tested ([`billing.test.ts:43`](tests/server/billing.test.ts:43)). And `trial_period_days` appears nowhere in `src/` — no trial is ever created.

This matters more for KAIROS than for a generic SaaS, because of the boundary the pricing memo deliberately chose. Pro is "the thing that runs without you". A free user never sees the Daily Brief, never sees the Risk Radar, and therefore never experiences the one thing they are being asked to pay for. The free tier demonstrates the product it is not selling.

A trial is the only mechanism that closes that gap, and it needs to be long enough to contain several mornings:

```ts
subscription_data: {
  trial_period_days: 14,
  trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
  metadata: { /* … as today … */ },
},
```

Fourteen days gives roughly ten Daily Briefs and at least one weekly retrospective. Ask for the card up front (which the snippet above assumes) — it converts materially better than a card-less trial, and the plumbing already handles the `trialing → active` transition without any new code.

## B2 — Team cannot be bought by the people most likely to want it *(high)*

The blocker chain in [`PlanCard`](src/components/settings/BillingSettingsClient.tsx:445) reads:

```
plan === "team" && !organization  →  t("teamNeedsOrg")
```

…and that is a dead end. The button is disabled and the text explains why, but there is no link, no inline "Create one", nothing. A solo user who reads the pricing page, decides they want to bring in two colleagues, and clicks through to billing is shown a disabled button and a sentence.

That is the *exact* moment of highest purchase intent in the entire funnel, and it terminates.

`organization.create` exists and is not plan-gated. Make the blocker a control: "Team is bought for an organization. **Create one →**", which creates the org and returns to the same card, now buyable. A couple of hours of work on the highest-intent screen in the product.

## B5 — There is no verified upgrade path from Pro to Team *(high)*

[`billing.ts:208`](src/server/api/routers/billing.ts:208) refuses a second checkout with "You already have a subscription. Change it from the billing portal." The reasoning is sound — the portal prorates and checkout does not.

But the Stripe billing portal only offers plan switching if the products are explicitly configured under **Portal settings → Products**, and nothing in this repo records whether that was done. There is no `billingPortal.configurations.create` call and no note in the docs. If it has not been configured, the message is false: a Pro subscriber cannot reach Team at all without cancelling first and waiting out their period.

Verify it in the dashboard today. Better, pin it down in code — create a portal configuration at deploy time listing both products and both intervals, and pass its id to `billingPortal.sessions.create`. That turns "someone configured this correctly once" into something a deploy guarantees.

While you are there, confirm the portal's cancellation flow is set to `at_period_end` rather than immediate. An immediate cancellation refunds nothing and loses the remaining paid period, which generates exactly the support ticket `willNotRenew` was written to prevent.

## B3 — The public pricing page drops purchase intent *(medium)*

[`PricingTable.tsx:162`](src/components/marketing/PricingTable.tsx:162) sends a signed-out visitor to `/` — the landing page. The comment explains why not `signInHref` (the `reason=expired` copy would confuse a first-time visitor), which is right, but the chosen plan and interval are thrown away. After signing up, the user lands on `/dashboard` and must independently discover Settings → Billing.

Carry the intent: link to `/?plan=pro&interval=year`, persist it across the auth round trip, and on first landing either open the billing section with that card focused or start the checkout directly. Every step between "I want this" and "here is my card" costs a measurable fraction of the people on it, and there are currently three.

## B4 — The annual discount is under-sold *(medium)*

`annualSavingPercent` correctly derives 17% from the two prices, and it is shown in one place: the toggle label on the public page ([`PricingTable.tsx:83`](src/components/marketing/PricingTable.tsx:83)). The settings toggle does not show it at all — it renders a plain `intervalYear` string.

Three changes, all cheap, all pure upside on cash flow:

1. **Default both toggles to annual.** The monthly default asks every customer to opt *into* the cheaper commitment. Reverse it.
2. **Say "2 months free", not "save 17%".** That is the memo's own phrasing and it is strictly better copy — it names a concrete thing received rather than an abstract percentage off.
3. **Show the monthly equivalent.** "€10/month, billed annually" beside "€120/year" is what makes the annual price comparable at a glance. Right now a visitor toggling to yearly watches €12 become €120 and has to do the division themselves.

Annual billing also materially improves the thing a diploma-stage product is worst at — cash flow — and reduces churn mechanically, because a customer who must actively cancel once a year churns less than one who can lapse monthly.

## B6 — The advertised request quotas are not what users get *(medium)*

`aiRequestsPerDay` is 15 on Free and 200 on Pro, and both numbers appear verbatim on the pricing page. But [`recordExtraAiCall`](src/server/security/rateLimit.ts:126) charges the *user's* window for JSON repair rounds, truncation retries and each tool-loop iteration. The docblock is candid about it: one chat message can cost several completions.

So "15 AI requests per day" is really somewhere between 15 and 5 messages depending on how many tools a turn happens to use, and the user has no way to know which. The memo's whole free-tier strategy is "they form the habit on the full thing" — that strategy fails if the meter runs faster than the number on the page.

The right split is the one the codebase already invented for scheduled work: internal retries are the system's cost of doing business, not the user's request. Meter them against a separate window (as `AI_SYSTEM_RATE_LIMIT` does for proactive runs), keep the user-facing counter equal to user-initiated turns, and the number on the pricing page becomes true.

---

# C. Correctness risks that cost money

## C1 — An unmappable price ID silently downgrades a paying customer *(high)*

[`planFromPriceId`](src/server/billing/stripe.ts:121) returns `null` for any price it does not recognise. [`planFromSubscription`](src/lib/subscription-status.ts:44) turns a `null` plan into `"free"`. `syncSubscription` writes it without comment — `planOf` only warns about *multiple* items, never about an unrecognised one.

So if a price is rotated in the Stripe dashboard, or a deployment runs live keys against a test-mode price ID, then every renewal webhook for every paying customer resolves to `free` and revokes their plan. Silently. The only log line is `"subscription synced"` at info, reporting `plan: "free"` as though that were the answer.

Given that this project has already hit test-vs-live key confusion once, this is not hypothetical.

Two changes:

1. `log.error` when a subscription whose status `isLiveSubscription` maps to a `null` plan. This is precisely the "money moved and nobody got anything" condition that `syncSubscription` already logs loudly for a missing owner — the same reasoning applies here and the same severity should.
2. **Do not downgrade on an unmappable price.** Keep the stored plan, write the rest of the patch, and raise. Being wrong in the customer's favour for a few hours while someone investigates costs far less than revoking a paying customer's plan.

## C2 — Organizational dunning is invisible to the admin *(medium)*

[`BillingSettingsClient.tsx:189`](src/components/settings/BillingSettingsClient.tsx:189) renders a "Payment failed" row — but only inside `CurrentPlanGroup`, and only for `personal.status`. `OrganizationGroup` renders plan, seats and the manage button; it never branches on `organization.status`, even though `billing.summary` returns it.

A Team org's card expires, Stripe retries for weeks (during which `past_due` correctly keeps the plan — that decision is right), and the admin who could fix it in thirty seconds sees nothing anywhere in the product. Then it cancels, and an entire team loses access at once.

Add the same `past_due` row to the org group. Beyond that: the billing settings page is the one screen a customer with a working subscription has no reason to open, so a `past_due` state should raise a persistent banner in the app shell rather than wait to be found.

## C3 — Half the billing copy is untranslated *(medium)*

Of the 42 strings under `settings.billing`, **23 are byte-identical to English in `bg.json`** and 24 in `de.json`. The untranslated set is not random — it is almost exactly the commercial surface:

`pastDueTitle`, `pastDueBody`, `orgTitle`, `orgDescription`, `overSeatsTitle`, `overSeatsBody`, `orgManageTitle`, `orgManageBody`, `orgManageDenied`, `upgradeDescription`, `upgradeFooter`, `intervalLabel`, `manageTitle`, `manageBody`…

Every seat message, every dunning message, every upgrade explanation. In a product that ships five interface languages and prices in euros for a European market, the checkout is the least localised screen in it — and for a Bulgarian buyer, "Your card was declined" in English at the moment their payment fails is the worst possible place to drop the localisation.

The Stripe-hosted pages localise themselves from the browser locale, so this is only about the app's own copy. It is a translation pass, not engineering.

---

# What to do first

Ordered by return on the hour spent, not by severity:

**This week — stops the bleeding, all small:**

1. `automatic_tax` + `customer_update` in the checkout session (A2). Two lines, and every day it waits is an invoice you cannot re-issue cleanly.
2. Audit the Stripe coupons for `forever` duration and missing redemption caps (A3). An afternoon in the dashboard.
3. `log.error` and refuse-to-downgrade on an unmappable price (C1). Fifteen lines, prevents the worst silent failure in the system.
4. Verify the portal is configured for plan switching and `at_period_end` cancellation (B5). Ten minutes, and it may be the reason nobody has upgraded.

**This month — the actual revenue:**

5. Enforce seats at join, with a 7-day grace and a one-click "add a seat" (A1). The single largest number on this list.
6. `trial_period_days: 14` with card up front (B1). The plumbing is done; this is a config change and some copy.
7. Make "Create an organization" reachable from the Team card (B2).
8. Gate `undoApply`, per-agent memory and agent pinning, and add the test that asserts every boolean entitlement is read somewhere on the server (A4).

**Next — the compounding ones:**

9. Default to annual, say "2 months free", show the monthly equivalent (B4).
10. Carry plan intent from the public pricing page through sign-up into checkout (B3).
11. Meter internal retries separately so the advertised quota is the real quota (B6).
12. Org `past_due` row, app-shell dunning banner, and the "you are paying twice" row (C2, A5).
13. Translate the 23 billing strings (C3).

---

## A note on what is already right

Worth recording, because an audit that lists only problems misrepresents the codebase. The single-writer rule in `subscriptions.ts`; the decision to put `planFromSubscription` in a pure module *because the jsdom suite was silently collecting zero tests*; the `willNotRenew` double-field check; the superseded-subscription guards in both directions; the refusal to rebuild cancellation locally; and the explicit choice that the redirect is not the payment — these are all decisions that products usually discover the hard way. The findings above are about the layer that decides who is entitled to what, not about the layer that talks to Stripe.
