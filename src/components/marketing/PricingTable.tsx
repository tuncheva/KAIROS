"use client";

import { useState } from "react";
import Link from "next/link";

import {
  PLAN_CATALOGUE,
  annualMonthlyEquivalent,
  formatEuro,
  monthsFreeOnAnnual,
  priceFor,
  type BillingInterval,
} from "~/lib/plans";
import type { PlanId } from "~/lib/entitlements";

/**
 * The three tiers, on the public page.
 *
 * **It sells; it does not transact.** Every button is a link to sign-up or to
 * the billing screen, never a checkout mutation — a pre-auth visitor has no
 * account to attach a subscription to, and a checkout that has to invent one
 * mid-payment is how a paid subscription ends up owned by nobody. The purchase
 * happens in Settings → Billing, one authenticated step later.
 *
 * Client-side only for the monthly/yearly toggle. Everything else it renders
 * comes from `~/lib/plans`, which the settings screen reads too — so the price a
 * visitor is quoted here and the price they are charged there cannot drift.
 */
export function PricingTable({ signedIn }: { signedIn: boolean }) {
  // Annual by default. Monthly-by-default asks every visitor to opt *into* the
  // cheaper commitment, which means most never see it — the toggle is the only
  // place the discount is mentioned. Starting here shows the better price first
  // and lets someone who wants monthly say so, which is the direction that costs
  // nothing if they do.
  const [interval, setInterval] = useState<BillingInterval>("year");

  return (
    <div className="flex flex-col gap-10">
      <IntervalToggle value={interval} onChange={setInterval} />

      <div className="grid gap-4 lg:grid-cols-3">
        {(["free", "pro", "team"] as const).map((plan) => (
          <PlanColumn
            key={plan}
            plan={plan}
            interval={interval}
            signedIn={signedIn}
          />
        ))}
      </div>

      <p className="text-[13px] leading-[1.7] text-fg-tertiary">
        Prices are per seat and exclude VAT. Paid plans can be cancelled at any
        time; access runs to the end of the period already paid for.
      </p>
    </div>
  );
}

function IntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      className="inline-flex w-fit gap-1 rounded-full border border-border-light p-1"
    >
      {(["month", "year"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
            value === option
              ? "bg-bg-tertiary font-medium text-fg-primary"
              : "text-fg-tertiary hover:text-fg-primary"
          }`}
        >
          {option === "year"
            ? // Derived from the two prices rather than written as "2", so the
              // claim cannot outlive the numbers that justify it. Months rather
              // than the equivalent percentage because it is the unit the
              // subscription is already measured in — see `monthsFreeOnAnnual`.
              `Yearly · ${monthsFreeOnAnnual("pro")} months free`
            : "Monthly"}
        </button>
      ))}
    </div>
  );
}

/**
 * The billing screen, told which plan the visitor already chose.
 *
 * `section=billing` is what opens the right settings panel; `plan` and
 * `interval` are read by `BillingSettingsClient` to preselect rather than to
 * buy. Deliberately not a link that starts a checkout: the visitor has not
 * signed in yet at the point this is built, and a URL that charges someone on
 * arrival is not a URL to hand out.
 */
function billingHref(plan: "pro" | "team", interval: BillingInterval): string {
  return `/settings?section=billing&plan=${plan}&interval=${interval}`;
}

function PlanColumn({
  plan,
  interval,
  signedIn,
}: {
  plan: PlanId;
  interval: BillingInterval;
  signedIn: boolean;
}) {
  const descriptor = PLAN_CATALOGUE[plan];

  // Pro is the tier the pricing memo argues for, so it is the one the layout
  // points at. Emphasis is a single highlighted column rather than a "most
  // popular" badge, which is a claim about other customers we cannot support.
  const featured = plan === "pro";

  return (
    <div
      className={`flex flex-col gap-5 rounded-lg border p-6 ${
        featured
          ? "border-accent-primary/40 bg-bg-elevated"
          : "border-border-light bg-transparent"
      }`}
    >
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-primary">
          {plan}
        </p>
        <h2 className="mt-3 font-display text-[28px] leading-[1.1] font-normal text-fg-primary">
          {descriptor.name}
        </h2>
        <p className="mt-2 text-[14px] leading-[1.6] text-fg-secondary">
          {descriptor.tagline}
        </p>
      </div>

      <div className="text-fg-primary">
        {descriptor.pricing ? (
          <>
            <p>
              <span className="font-display text-[40px] leading-none">
                {formatEuro(priceFor(plan as "pro" | "team", interval))}
              </span>
              <span className="ml-2 text-[13px] text-fg-tertiary">
                per seat / {interval === "year" ? "year" : "month"}
              </span>
            </p>
            {interval === "year" ? (
              // The figure that makes the two intervals comparable. Without it a
              // visitor toggling to yearly watches €12 become €120 and has to do
              // the division themselves to find out it is cheaper.
              <p className="mt-1.5 text-[13px] text-fg-tertiary">
                {formatEuro(annualMonthlyEquivalent(plan as "pro" | "team"))} per
                seat / month, billed yearly
              </p>
            ) : null}
          </>
        ) : (
          <span className="font-display text-[40px] leading-none">Free</span>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {descriptor.highlights.map((line) => (
          <li
            key={line}
            className="flex gap-2.5 text-[13.5px] leading-[1.55] text-fg-secondary"
          >
            <span aria-hidden className="mt-[2px] text-accent-primary">
              ·
            </span>
            {line}
          </li>
        ))}
      </ul>

      <Link
        /* A signed-out visitor is sent to the landing page, which is where this
           app's sign-in lives — not to `signInHref`, whose `reason=expired`
           would tell a first-time visitor their session had run out. Once signed
           in, every paid CTA goes straight to the screen that can actually
           start a checkout.

           The plan and interval ride along either way. Clicking "yearly Pro"
           and arriving at a billing screen defaulted to something else means
           choosing twice, and the second choice happens after the enthusiasm
           that produced the first one. For a signed-out visitor it goes through
           `callbackUrl`, which the sign-in modal already honours for same-site
           paths — the mechanism exists because a scanned invite QR had the same
           problem. */
        href={
          !signedIn
            ? plan === "free"
              ? "/"
              : `/?callbackUrl=${encodeURIComponent(billingHref(plan, interval))}`
            : plan === "free"
              ? "/dashboard"
              : billingHref(plan, interval)
        }
        className={`mt-auto rounded-lg px-4 py-2.5 text-center text-[13.5px] font-medium transition-colors ${
          featured
            ? "bg-accent-primary text-white hover:opacity-90"
            : "border border-border-medium text-fg-primary hover:bg-bg-tertiary"
        }`}
      >
        {!signedIn
          ? plan === "free"
            ? "Start free"
            : "Sign in to subscribe"
          : plan === "free"
            ? "Open KAIROS"
            : `Choose ${descriptor.name}`}
      </Link>
    </div>
  );
}
