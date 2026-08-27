"use client";

/**
 * How the feed on screen is doing — as a dialog rather than a rail panel.
 *
 * This used to be the bottom card of the right column: three tiles and three
 * bars squeezed into 240px, which is the wrong shape for the numbers and was
 * spending column width the feed needed more. It is now a button in the feed
 * toolbar that opens the same summary at a size it can actually be read at —
 * every tile spelled out, and the ten busiest events instead of three.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Heart,
  MessageCircle,
  X,
} from "lucide-react";

import {
  eventDateParts,
  regionLabel,
  summariseEngagement,
  type FeedEvent,
} from "./feedData";
import { Stamp } from "./publishUi";

/** The toolbar button. Renders nothing when there is nothing to summarise. */
export function EventProgressButton({ events }: { events: FeedEvent[] }) {
  const t = useTranslations("publish");
  const [open, setOpen] = useState(false);

  if (events.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-fg-secondary transition-colors hover:border-accent-primary/40 hover:text-accent-primary dark:border-white/10 dark:bg-white/5"
      >
        <BarChart3 size={14} className="text-accent-primary" />
        <span className="hidden sm:inline">{t("eventProgress")}</span>
      </button>

      {open && <EventProgressDialog events={events} onClose={() => setOpen(false)} />}
    </>
  );
}

function EventProgressDialog({
  events,
  onClose,
}: {
  events: FeedEvent[];
  onClose: () => void;
}) {
  const t = useTranslations("publish");
  const locale = useLocale();
  const summary = useMemo(() => summariseEngagement(events), [events]);

  /* Escape closes, and the page behind does not scroll while it is open. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (!summary || typeof document === "undefined") return null;

  const tiles = [
    { Icon: CalendarDays, value: summary.totalEvents, label: t("title") },
    { Icon: Heart, value: summary.totalLikes, label: t("likes") },
    { Icon: MessageCircle, value: summary.totalComments, label: t("comments") },
    { Icon: Activity, value: summary.totalRsvps, label: "RSVPs" },
  ];

  const ranked = [...events]
    .sort(
      (a, b) =>
        b.likeCount + b.commentCount - (a.likeCount + a.commentCount),
    )
    .slice(0, 10);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("eventProgress")}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="dash-rise flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-white/10 dark:bg-[#0e0e14]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
          <span className="flex flex-col">
            <h2 className="text-[15px] font-semibold text-fg-primary">
              {t("eventProgress")}
            </h2>
            <Stamp className="tracking-[0.14em]">{t("progressScope")}</Stamp>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-full p-1.5 text-fg-tertiary transition-colors hover:bg-slate-100 hover:text-fg-primary dark:hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map(({ Icon, value, label }) => (
              <div
                key={label}
                className="rounded-xl bg-accent-primary/5 p-3 text-center dark:bg-white/5"
              >
                <Icon size={15} className="mx-auto mb-1 text-accent-primary" />
                <dd className="kairos-mono text-lg font-bold text-fg-primary">
                  {value}
                </dd>
                <dt className="text-[10px] text-fg-tertiary">{label}</dt>
              </div>
            ))}
          </dl>

          <h3 className="mb-2.5 mt-5 text-[13px] font-semibold text-fg-primary">
            {t("busiestEvents")}
          </h3>

          <ol className="flex flex-col gap-3.5">
            {ranked.map((event, index) => {
              const score = event.likeCount + event.commentCount;
              const percent = Math.round((score / summary.peak) * 100);
              const date = eventDateParts(event.eventDate, locale);

              return (
                <li key={event.id}>
                  <div className="mb-1.5 flex items-end justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="kairos-mono shrink-0 text-[11px] text-fg-quaternary">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-fg-primary">
                          {event.title}
                        </span>
                        <Stamp className="text-[9.5px] tracking-[0.12em]">
                          {date.day} {date.month} · {regionLabel(event.region)}
                        </Stamp>
                      </span>
                    </span>
                    <span className="kairos-mono shrink-0 text-[11px] font-bold text-accent-primary">
                      {percent}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                    <div
                      className="h-full rounded-full bg-accent-primary transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>,
    document.body,
  );
}
