"use client";

/**
 * How your events are doing.
 *
 * This started as three tiles and three bars squeezed into a 240px rail panel,
 * summing whatever rows the feed cursor had loaded — which meant it was
 * measuring how far the reader had scrolled rather than how an event had done.
 *
 * It is a dialog off the feed toolbar now, and the numbers come from
 * `event.getHostStats`: per-event totals from the tables, for events you host
 * or co-host. A host's own numbers, at a size they can be read at.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  Activity,
  BarChart3,
  Bookmark,
  CalendarDays,
  Heart,
  Loader2,
  MessageCircle,
  X,
} from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { eventDateParts, regionLabel } from "./feedData";
import { Stamp } from "./publishUi";

/** The toolbar button. Hidden from anyone who is not hosting anything. */
export function EventProgressButton() {
  const t = useTranslations("publish");
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  const { data: summary } = api.event.getMySummary.useQuery(undefined, {
    enabled: !!session,
  });

  if (!session || (summary?.counts.hosting ?? 0) === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-fg-secondary transition-colors hover:border-accent-primary/40 hover:text-accent-primary dark:border-white/10 dark:bg-white/5"
      >
        <BarChart3 size={14} className="text-accent-primary" />
        <span className="hidden sm:inline">{t("eventProgress")}</span>
      </button>

      {open && <EventProgressDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function EventProgressDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("publish");
  const locale = useLocale();
  const { data, isLoading } = api.event.getHostStats.useQuery();

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

  if (typeof document === "undefined") return null;

  const tiles = data
    ? [
        { Icon: CalendarDays, value: data.totals.events, label: t("title") },
        { Icon: Heart, value: data.totals.likes, label: t("likes") },
        { Icon: MessageCircle, value: data.totals.comments, label: t("comments") },
        { Icon: Activity, value: data.totals.rsvps, label: t("rsvps") },
        { Icon: Bookmark, value: data.totals.saves, label: t("saves") },
      ]
    : [];

  /* Bars are drawn against the busiest event rather than against capacity: not
     every event has a ceiling, and the question here is relative reach. */
  const peak = data
    ? Math.max(
        1,
        ...data.events.map(
          (event) => event.likeCount + event.commentCount + event.goingCount,
        ),
      )
    : 1;

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
        className="dash-rise flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-white/10 dark:bg-[#0e0e14]"
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
          {isLoading || !data ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-accent-primary" />
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
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
                {t("yourEvents")}
              </h3>

              {data.events.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-tertiary">
                  {t("noHostedEvents")}
                </p>
              ) : (
                <ol className="flex flex-col gap-3.5">
                  {data.events.map((event, index) => {
                    const score =
                      event.likeCount + event.commentCount + event.goingCount;
                    const percent = Math.round((score / peak) * 100);
                    const date = eventDateParts(event.eventDate, locale);

                    return (
                      <li key={event.id}>
                        <div className="mb-1.5 flex items-end justify-between gap-3">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="kairos-mono shrink-0 text-[11px] text-fg-quaternary">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0">
                              <a
                                href={`/events/${event.id}`}
                                className="block truncate text-[13px] font-semibold text-fg-primary transition-colors hover:text-accent-primary"
                              >
                                {event.title}
                              </a>
                              <Stamp className="text-[9.5px] tracking-[0.12em]">
                                {date.day} {date.month} ·{" "}
                                {regionLabel(event.region)} ·{" "}
                                {t("statLine", {
                                  going: event.goingCount,
                                  likes: event.likeCount,
                                  comments: event.commentCount,
                                })}
                              </Stamp>
                            </span>
                          </span>
                          {event.capacity !== null && (
                            <span className="kairos-mono shrink-0 text-[11px] font-bold text-accent-primary">
                              {Math.round(
                                (event.goingCount / event.capacity) * 100,
                              )}
                              %
                            </span>
                          )}
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
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
