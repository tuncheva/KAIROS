"use client";

/**
 * An event's page before the event arrives, in `EventPage`'s geometry: the
 * slim bar, the header card, the description column and the side cards. The
 * bar, section stamps and button labels are real; the event hatches.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Bookmark, Clock, Heart, MapPin, Share2 } from "~/components/ui/icons";
import { Skeleton, SkeletonLines, SkeletonStatus } from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";
import { Stamp } from "~/components/publish/publishUi";

export function EventPageSkeleton({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations("publish");
  const ts = useTranslations("skeleton");

  return (
    <main className="min-h-dvh bg-bg-primary pb-[calc(8rem+var(--kairos-safe-bottom))] lg:pb-10">
      <SkeletonStatus label={ts("status")} />

      <header className="sticky top-0 z-30 pt-[var(--kairos-safe-top)] border-b border-border-medium bg-bg-primary/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          {/* Real: going back needs nothing from the server. */}
          <Link
            href="/publish"
            className="flex items-center gap-2 text-[13px] font-semibold text-fg-secondary transition-colors hover:text-accent-primary"
          >
            <ArrowLeft size={16} />
            {t("backToEvents")}
          </Link>
          <span className="flex-1" />
          <span
            aria-hidden
            className="flex h-control-md items-center gap-2 rounded-lg border border-border-medium px-3 text-[13px] text-fg-tertiary"
          >
            <Share2 size={14} />
            <span className="hidden sm:inline">{t("share")}</span>
          </span>
        </div>
      </header>

      <div aria-hidden className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
        {/* The header card: chips, title, when and where. */}
        <div className="overflow-hidden rounded-lg border border-border-medium bg-bg-elevated">
          <div className="flex flex-col gap-3 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <Skeleton shape="title" className="h-[22px] w-16" row={0} />
              <Skeleton shape="title" className="h-[22px] w-20" row={0} />
            </div>
            <span className="flex h-[33px] items-center sm:h-10">
              <Skeleton shape="title" className="h-[22px] w-[62%] sm:h-[28px]" row={1} />
            </span>
            <div className="flex flex-wrap gap-2">
              <span className="flex h-control-md items-center gap-2 rounded-lg border border-border-medium px-3">
                <Clock size={13} className="text-fg-quaternary" />
                <Skeleton className="h-[9px] w-36" row={2} />
              </span>
              <span className="flex h-control-md items-center gap-2 rounded-lg border border-border-medium px-3">
                <MapPin size={13} className="text-fg-quaternary" />
                <Skeleton className="h-[9px] w-28" row={2} />
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section>
              <Stamp className="mb-2 block tracking-[0.14em]">{t("aboutThisEvent")}</Stamp>
              <div className="py-[7px]">
                <SkeletonLines widths={[96, 91, 94, 58]} row={3} gap="gap-[15px]" />
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-control-md items-center gap-2 rounded-lg border border-border-medium px-3 text-[13px] text-fg-tertiary">
                <Heart size={15} />
                <Skeleton className="h-[8px] w-3" row={5} />
              </span>
              <span className="flex h-control-md items-center gap-2 rounded-lg border border-border-medium px-3 text-[13px] text-fg-tertiary">
                <Bookmark size={15} />
                {t("save")}
              </span>
            </div>

            <SkeletonSlow what="events" onRetry={onRetry} className="mt-0" />
          </div>

          <aside className="flex flex-col gap-4 lg:self-start">
            <div className="hidden flex-col gap-3 rounded-lg border border-border-medium bg-bg-elevated p-4 lg:flex">
              <div className="flex items-center justify-between">
                <Stamp className="tracking-[0.14em]">{t("going")}</Stamp>
                <Skeleton shape="title" className="h-[16px] w-7" row={1} />
              </div>
              <div className="flex gap-1.5">
                {(["going", "maybe"] as const).map((key) => (
                  <span
                    key={key}
                    className="flex h-10 flex-1 items-center justify-center rounded-lg border border-border-medium text-[13px] font-semibold text-fg-tertiary"
                  >
                    {t(key)}
                  </span>
                ))}
                <span className="flex h-10 items-center rounded-lg border border-border-medium px-3 text-[13px] text-fg-tertiary">
                  {t("cantGo")}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border-medium bg-bg-elevated p-4">
              <Stamp className="tracking-[0.14em]">{t("hostedBy")}</Stamp>
              <div className="flex items-center gap-3">
                <Skeleton shape="circle" className="h-[38px] w-[38px]" row={2} />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-[9px] w-[55%]" row={2} />
                  <Skeleton className="h-[7px] w-[75%]" row={2} />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border-medium bg-bg-elevated p-4">
              <Stamp className="tracking-[0.14em]">{t("where")}</Stamp>
              <Skeleton className="my-[5px] h-[9px] w-[60%]" row={3} />
              <span className="mt-1 block aspect-[4/3] w-full rounded-md border border-dashed border-border-medium bg-bg-secondary" />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
