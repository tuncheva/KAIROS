"use client";

/**
 * The host's read on who is coming.
 *
 * Lifted out of the old 1155-line feed file unchanged in behaviour: three bars
 * over the same counts the card already has, so opening it costs no request.
 */

import { useTranslations } from "next-intl";
import { BarChart3, Calendar, TrendingUp, Users, X } from "lucide-react";

import { useDateFormat } from "~/hooks/useDateFormat";
import type { FeedEvent } from "./feedData";

function Breakdown({
  label,
  count,
  total,
  barClass,
  textClass,
}: {
  label: string;
  count: number;
  total: number;
  barClass: string;
  textClass: string;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-fg-secondary">{label}</span>
        <span className="font-semibold text-fg-primary">{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
        <div
          className={`h-full transition-all duration-500 ${barClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className={`text-right text-xs ${textClass}`}>
        {percentage.toFixed(1)}%
      </p>
    </div>
  );
}

export function RsvpDashboard({
  event,
  onClose,
}: {
  event: FeedEvent;
  onClose: () => void;
}) {
  const t = useTranslations("publish");
  const { formatDate } = useDateFormat();

  const total =
    event.rsvpCounts.going + event.rsvpCounts.maybe + event.rsvpCounts.notGoing;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("responsesDashboard")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/5 dark:bg-[#16151A]">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl bg-white/95 p-4 backdrop-blur-sm sm:p-6 dark:bg-[#16151A]/95">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent-primary/20">
              <BarChart3 size={18} className="text-accent-primary" />
            </div>
            <h2 className="text-lg font-bold text-fg-primary sm:text-xl">
              {t("responsesDashboard")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("edit.cancel")}
            className="rounded-lg p-2 text-accent-primary/60 transition-colors hover:bg-accent-primary/5 hover:text-accent-primary"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 p-4 sm:p-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5 dark:border-white/[0.06] dark:bg-bg-secondary">
            <div className="mb-2 flex items-center gap-3">
              <Users className="text-accent-primary" size={20} />
              <h3 className="text-base font-semibold text-fg-primary sm:text-lg">
                {t("totalResponses")}
              </h3>
            </div>
            <p className="mt-2 text-3xl font-bold text-accent-primary sm:text-4xl">
              {total}
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-accent-primary">
              <TrendingUp size={16} />
              {t("responseBreakdown")}
            </h3>

            <Breakdown
              label={t("going")}
              count={event.rsvpCounts.going}
              total={total}
              barClass="bg-accent-primary"
              textClass="text-accent-primary"
            />
            <Breakdown
              label={t("maybe")}
              count={event.rsvpCounts.maybe}
              total={total}
              barClass="bg-accent-primary/70"
              textClass="text-accent-primary/70"
            />
            <Breakdown
              label={t("cantGo")}
              count={event.rsvpCounts.notGoing}
              total={total}
              barClass="bg-accent-primary/50"
              textClass="text-accent-primary/50"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.06] dark:bg-bg-secondary">
            <h4 className="mb-2 text-sm font-semibold text-accent-primary">
              {t("eventDetails")}
            </h4>
            <p className="mb-1 font-medium text-fg-primary">{event.title}</p>
            <div className="flex items-center gap-2 text-xs text-fg-tertiary">
              <Calendar size={14} className="text-accent-primary" />
              <span>{formatDate(event.eventDate, "long")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
