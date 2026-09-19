"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { api, type RouterOutputs } from "~/trpc/react";
import { PLAN_CATALOGUE, formatEuro, priceFor, type BillingInterval } from "~/lib/plans";
import type { PlanId } from "~/lib/entitlements";

import {
  LedgerAction,
  LedgerError,
  LedgerGroup,
  LedgerSection,
  useSectionCrumb,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

/**
 * Settings → Billing. The plan, what it costs, and the two buttons that change
 * it.
 *
 * **Everything that mutates a subscription happens on Stripe, not here.** Both
 * actions do the same thing: ask the server for a URL and navigate to it. There
 * is no card form, no cancel confirmation, no seat editor — those are Stripe's
 * hosted pages, which already handle proration, dunning, tax and receipts.
 * Rebuilding any of them here would be rebuilding the parts that are regulated.
 *
 * The screen shows up to two subscriptions, because a person can be covered
 * twice: their own Pro, and the Team plan their organization pays for. It shows
 * both rather than only the winning one, so that someone whose Pro lapsed while
 * their org's Team plan carries them can see *why* they still have the features
 * — and can stop paying for the one that is now redundant.
 */
export function BillingSettingsClient() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.billing");
  const crumb = useSectionCrumb("billing");

  const utils = api.useUtils();
  const { data, isLoading } = api.billing.summary.useQuery();

  const outcome = useCheckoutOutcome(utils);

  return (
    <LedgerSection
      sectionId="billing"
      crumb={crumb}
      title={t("title")}
      subtitle={t("subtitle")}
    >
      {outcome ? <CheckoutBanner outcome={outcome} t={t} /> : null}

      <CurrentPlanGroup t={t} data={data} isLoading={isLoading} />

      {data?.organization ? (
        <OrganizationGroup t={t} organization={data.organization} />
      ) : null}

      <PlansGroup t={t} data={data} />
    </LedgerSection>
  );
}

// ---------------------------------------------------------------------------
// Returning from Stripe
// ---------------------------------------------------------------------------

type Outcome = "success" | "cancelled";

/**
 * Read `?checkout=` and, on success, refresh the plan.
 *
 * The invalidation is the point. `useEntitlements` caches with
 * `staleTime: Infinity` — correct, because a plan does not change while the app
 * is open — and this is the one moment that assumption is false. Without it a
 * user who has just paid keeps seeing the Free UI until they reload, which reads
 * as the payment not having worked.
 *
 * It fires on a delay *and* repeatedly for a reason: the webhook that actually
 * grants the plan races the browser redirect, and Stripe usually — but not
 * always — wins. Three attempts over six seconds covers the gap without
 * committing to a polling loop that would still be running if the webhook never
 * arrives at all.
 */
function useCheckoutOutcome(utils: ReturnType<typeof api.useUtils>): Outcome | null {
  const params = useSearchParams();
  const raw = params.get("checkout");
  const outcome: Outcome | null =
    raw === "success" ? "success" : raw === "cancelled" ? "cancelled" : null;

  useEffect(() => {
    if (outcome !== "success") return;

    const timers = [0, 2000, 6000].map((delay) =>
      setTimeout(() => {
        void utils.billing.summary.invalidate();
        void utils.billing.entitlements.invalidate();
      }, delay),
    );

    return () => timers.forEach(clearTimeout);
  }, [outcome, utils]);

  return outcome;
}

function CheckoutBanner({ outcome, t }: { outcome: Outcome; t: Translator }) {
  const success = outcome === "success";

  return (
    <div
      role="status"
      className={`rounded-lg border p-3 text-[13px] ${
        success
          ? "border-accent-primary/40 bg-accent-primary/[0.08] text-fg-primary"
          : "border-border-medium bg-bg-tertiary/40 text-fg-secondary"
      }`}
    >
      <p className="font-medium">{t(success ? "successTitle" : "cancelledTitle")}</p>
      <p className="mt-1 text-fg-tertiary">
        {t(success ? "successBody" : "cancelledBody")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Current plan
// ---------------------------------------------------------------------------

/**
 * Taken from the router's inferred output rather than from the hook's `data`.
 * Reading it off `useQuery` resolves to `{}` here — the hook's return type is
 * not generic enough to narrow through — and every field access then fails.
 */
type Summary = RouterOutputs["billing"]["summary"];

function CurrentPlanGroup({
  t,
  data,
  isLoading,
}: {
  t: Translator;
  data: Summary | undefined;
  isLoading: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const portal = api.billing.createPortalSession.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => setError(err.message),
  });

  const plan = data?.effective.plan ?? "free";
  const personal = data?.personal;

  const rows: LedgerRow[] = [
    {
      id: "plan",
      title: t("currentPlan"),
      desc: isLoading ? t("loading") : t(`planName.${plan}`),
      keywords: "subscription tier pro team free",
      control: (
        <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-accent-primary">
          {plan}
        </span>
      ),
    },
  ];

  if (personal && personal.plan !== "free") {
    rows.push({
      id: "renews",
      // "Renews on" and "ends on" are the same date and opposite news. Showing
      // one label for both is how a cancelled subscriber believes they are still
      // covered next month.
      title: t(personal.cancelAtPeriodEnd ? "endsOn" : "renewsOn"),
      desc: personal.currentPeriodEnd
        ? new Date(personal.currentPeriodEnd).toLocaleDateString()
        : t("unknownDate"),
    });

    if (personal.status === "past_due") {
      rows.push({
        id: "pastDue",
        title: t("pastDueTitle"),
        desc: t("pastDueBody"),
        danger: true,
      });
    }
  }

  if (personal?.manageable) {
    rows.push({
      id: "manage",
      title: t("manageTitle"),
      desc: t("manageBody"),
      control: (
        <LedgerAction
          onClick={() => {
            setError(null);
            portal.mutate({});
          }}
          disabled={portal.isPending}
        >
          {portal.isPending ? t("opening") : t("manage")}
        </LedgerAction>
      ),
    });
  }

  return (
    <LedgerGroup
      label={t("currentTitle")}
      hint={t("currentDescription")}
      rows={rows}
      block={error ? <LedgerError>{error}</LedgerError> : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

function OrganizationGroup({
  t,
  organization,
}: {
  t: Translator;
  organization: NonNullable<Summary["organization"]>;
}) {
  const [error, setError] = useState<string | null>(null);

  const portal = api.billing.createPortalSession.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => setError(err.message),
  });

  const overSeats =
    organization.plan !== "free" && organization.memberCount > organization.seats;

  const rows: LedgerRow[] = [
    {
      id: "orgPlan",
      title: organization.name,
      desc: t(`planName.${organization.plan}`),
      control: (
        <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-fg-tertiary">
          {organization.plan}
        </span>
      ),
    },
  ];

  if (organization.plan !== "free") {
    rows.push({
      id: "seats",
      title: t("seatsTitle"),
      // Both numbers, always. "8 seats" alone does not tell an admin that they
      // have nine people, and the gap is the only thing they can act on.
      desc: t("seatsBody", {
        seats: organization.seats,
        members: organization.memberCount,
      }),
      danger: overSeats,
    });

    if (overSeats) {
      rows.push({
        id: "overSeats",
        title: t("overSeatsTitle"),
        desc: t("overSeatsBody"),
        danger: true,
      });
    }
  }

  if (organization.manageable) {
    rows.push({
      id: "orgManage",
      title: t("orgManageTitle"),
      // An admin gets a button; everyone else gets the sentence that tells them
      // who to ask, rather than a control that returns FORBIDDEN.
      desc: organization.canManage ? t("orgManageBody") : t("orgManageDenied"),
      control: organization.canManage ? (
        <LedgerAction
          onClick={() => {
            setError(null);
            portal.mutate({ organizationId: organization.id });
          }}
          disabled={portal.isPending}
        >
          {portal.isPending ? t("opening") : t("manage")}
        </LedgerAction>
      ) : undefined,
    });
  }

  return (
    <LedgerGroup
      label={t("orgTitle")}
      hint={t("orgDescription")}
      rows={rows}
      block={error ? <LedgerError>{error}</LedgerError> : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

function PlansGroup({ t, data }: { t: Translator; data: Summary | undefined }) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [error, setError] = useState<string | null>(null);

  const checkout = api.billing.createCheckoutSession.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => setError(err.message),
  });

  const current: PlanId = data?.effective.plan ?? "free";

  // Nothing to sell to someone who already has the top tier. The group
  // disappears rather than rendering three cards with every button disabled.
  if (current === "team") return null;

  return (
    <LedgerGroup
      label={t("upgradeTitle")}
      hint={t("upgradeDescription")}
      note={t("upgradeFooter")}
      block={
        <div className="flex flex-col gap-4">
          <IntervalToggle t={t} value={interval} onChange={setInterval} />

          <div className="grid gap-3 sm:grid-cols-2">
            {(["pro", "team"] as const).map((plan) => (
              <PlanCard
                key={plan}
                t={t}
                plan={plan}
                interval={interval}
                current={current}
                purchasable={data?.purchasable[plan] ?? false}
                organization={data?.organization ?? null}
                // The trial is per owner, so Pro reads the personal flag and
                // Team the organization's — a buyer who has used one may still
                // have the other.
                trialDays={
                  (plan === "team" ? data?.trial.organization : data?.trial.personal)
                    ? (data?.trial.days ?? 0)
                    : 0
                }
                pending={checkout.isPending}
                onBuy={() => {
                  setError(null);
                  checkout.mutate({
                    plan,
                    interval,
                    organizationId:
                      plan === "team" ? data?.organization?.id : undefined,
                  });
                }}
              />
            ))}
          </div>

          {error ? <LedgerError>{error}</LedgerError> : null}
        </div>
      }
    />
  );
}

function IntervalToggle({
  t,
  value,
  onChange,
}: {
  t: Translator;
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={t("intervalLabel")}
      className="inline-flex w-fit gap-1 rounded-lg border border-border-medium p-1"
    >
      {(["month", "year"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
            value === option
              ? "bg-accent-primary/15 font-medium text-fg-primary"
              : "text-fg-tertiary hover:text-fg-secondary"
          }`}
        >
          {t(option === "year" ? "intervalYear" : "intervalMonth")}
        </button>
      ))}
    </div>
  );
}

function PlanCard({
  t,
  plan,
  interval,
  current,
  purchasable,
  organization,
  trialDays,
  pending,
  onBuy,
}: {
  t: Translator;
  plan: "pro" | "team";
  interval: BillingInterval;
  current: PlanId;
  purchasable: boolean;
  organization: Summary["organization"];
  /** Days of free trial on offer, or 0 when this buyer has had theirs. */
  trialDays: number;
  pending: boolean;
  onBuy: () => void;
}) {
  const descriptor = PLAN_CATALOGUE[plan];
  const owned = current === plan;

  /**
   * Why this plan cannot be bought right now, or null if it can.
   *
   * One value rather than three booleans, because the button and its
   * explanation must never disagree — a disabled button beside "Upgrade now" is
   * the state this collapses out of existence.
   */
  const blocker: string | null = owned
    ? t("alreadyOn")
    : !purchasable
      ? t("notConfigured")
      : plan === "team" && !organization
        ? t("teamNeedsOrg")
        : plan === "team" && !organization?.canManage
          ? t("teamNeedsAdmin")
          : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-medium p-4">
      <div>
        <p className="text-[13px] font-semibold text-fg-primary">
          {t(`planName.${plan}`)}
        </p>
        <p className="mt-0.5 text-[12.5px] text-fg-tertiary">{descriptor.tagline}</p>
      </div>

      <p className="text-fg-primary">
        <span className="text-[22px] font-semibold tracking-[-0.02em]">
          {formatEuro(priceFor(plan, interval))}
        </span>
        <span className="ml-1 text-[12px] text-fg-tertiary">
          {t(interval === "year" ? "perSeatYear" : "perSeatMonth")}
        </span>
      </p>

      <ul className="flex flex-col gap-1.5">
        {descriptor.highlights.map((line) => (
          <li key={line} className="flex gap-2 text-[12.5px] text-fg-secondary">
            <span aria-hidden className="text-accent-primary">
              •
            </span>
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-1.5 pt-1">
        <LedgerAction onClick={onBuy} disabled={pending || blocker !== null}>
          {pending
            ? t("opening")
            : // The offer goes on the button, not beside it. "Start your free
              // month" is a different decision from "Choose Pro" — the second
              // asks for a commitment the first does not.
              trialDays > 0 && blocker === null
              ? t("startTrial", { days: trialDays })
              : t("choose", { plan: t(`planName.${plan}`) })}
        </LedgerAction>
        {blocker ? (
          <p className="text-[11.5px] text-fg-quaternary">{blocker}</p>
        ) : trialDays > 0 ? (
          // What happens at the end, said before the decision rather than in a
          // renewal email. A trial that collects no card and does not say so
          // reads as a subscription the buyer has forgotten the terms of.
          <p className="text-[11.5px] text-fg-quaternary">
            {t("trialNote", { days: trialDays })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
