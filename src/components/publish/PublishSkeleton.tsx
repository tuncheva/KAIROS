"use client";

/**
 * The events feed before its data lands, in the loaded geometry.
 *
 * What the page knows without asking renders for real: the rail's views and
 * filter names, the composer, the feed toolbar, the RSVP and reaction labels on
 * a card. What comes from the server hatches: the cover, the date tile's
 * figures, the title and meta, every count, and the people in the side column.
 * Controls are outlines and inert.
 */

import { useTranslations } from "next-intl";
import {
  Bell,
  Bookmark,
  CalendarDays,
  CalendarPlus,
  Clock,
  Heart,
  ImagePlus,
  MapPin,
  MessageCircle,
  Search,
  Users,
} from "~/components/ui/icons";
import { Skeleton, SkeletonStatus, skeletonWidth } from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";
import { TopBar } from "~/components/layout/TopBar";

import { FEED_VIEWS, TOPICS } from "./feedData";
import { Panel, Stamp, TitledPanel } from "./publishUi";

const CARD_SHELL =
  "overflow-hidden rounded-lg bg-bg-elevated shadow-[0_0_0_0.5px_rgba(200,200,200,0.55),0_2px_8px_-2px_rgba(0,0,0,0.08),0_4px_16px_-4px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_0.5px_rgba(60,60,60,0.9),0_2px_12px_-2px_rgba(0,0,0,0.4),0_6px_24px_-6px_rgba(0,0,0,0.3)]";

/** One feed card: `EventCard` with the event's data hatched. */
export function EventCardSkeleton({ index = 0 }: { index?: number }) {
  const t = useTranslations("publish");
  const row = index * 3;

  return (
    <div aria-hidden className={CARD_SHELL}>
      {/* Who posted it. */}
      <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
        <Skeleton shape="circle" className="h-9 w-9" row={row} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-[9px]" row={row} style={{ width: skeletonWidth(index * 7 + 1, 22, 38) }} />
          <Skeleton className="h-[7px]" row={row} style={{ width: skeletonWidth(index * 7 + 2, 30, 48) }} />
        </div>
      </div>

      {/* The cover — flush to the card, as the wash is. */}
      <Skeleton shape="block" className="h-[104px] w-full" row={row + 1} style={{ borderRadius: 0 }} />

      {/* When, then what, then where. */}
      <div className="flex items-start gap-3.5 px-3.5 pt-3">
        <div className="flex w-[58px] shrink-0 flex-col items-center gap-[7px] rounded-xl border border-border-medium py-[11px]">
          <Skeleton className="h-[6px] w-6" row={row + 1} />
          <Skeleton shape="title" className="h-[16px] w-6" row={row + 1} />
          <Skeleton className="h-[6px] w-8" row={row + 1} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex h-[25px] items-center">
            <Skeleton
              shape="title"
              className="h-[14px]"
              row={row + 1}
              style={{ width: skeletonWidth(index * 7 + 3, 48, 72) }}
            />
          </span>
          <span className="flex flex-col gap-[12px] py-[6px]">
            <Skeleton className="h-[9px] w-[94%]" row={row + 2} />
            <Skeleton
              className="h-[9px]"
              row={row + 2}
              style={{ width: skeletonWidth(index * 7 + 4, 38, 62) }}
            />
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-control-sm items-center gap-1.5 rounded-lg border border-border-medium px-2">
              <MapPin size={11} className="text-fg-quaternary" />
              <Skeleton className="h-[7px] w-20" row={row + 2} />
            </span>
            <span className="flex h-control-sm items-center gap-1.5 rounded-lg border border-border-medium px-2">
              <Clock size={11} className="text-fg-quaternary" />
              <Skeleton className="h-[7px] w-14" row={row + 2} />
            </span>
          </div>
        </div>
      </div>

      {/* The answer row: real labels, outlines only. */}
      <div className="flex gap-1.5 px-3.5 pt-3">
        {(["going", "maybe", "cantGo"] as const).map((key) => (
          <span
            key={key}
            className="flex h-control-md flex-1 items-center justify-center rounded-lg border border-border-medium text-[12.5px] font-semibold text-fg-tertiary"
          >
            {t(key)}
          </span>
        ))}
      </div>

      {/* Reactions: the icons are known, the counts are not. */}
      <div className="mt-3 flex items-center gap-0.5 border-t border-border-light px-2.5 py-2 text-fg-quaternary">
        <span className="flex h-8 items-center gap-1.5 px-2.5">
          <Heart size={15} />
          <Skeleton className="h-[7px] w-3" row={row + 2} />
        </span>
        <span className="flex h-8 items-center gap-1.5 px-2.5">
          <MessageCircle size={15} />
          <Skeleton className="h-[7px] w-3" row={row + 2} />
        </span>
        <span className="grid h-8 w-8 place-items-center">
          <Bookmark size={15} />
        </span>
        <span className="flex-1" />
        <span className="flex h-8 items-center gap-1.5 px-2.5 text-[12px]">
          <Bell size={15} />
          <span className="hidden sm:inline">{t("remindMe")}</span>
        </span>
      </div>
    </div>
  );
}

/** The feed's body while the first page is in flight. */
export function FeedSkeleton({
  count = 3,
  onRetry,
}: {
  count?: number;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <EventCardSkeleton key={i} index={i} />
      ))}
      <SkeletonSlow what="events" onRetry={onRetry} />
    </div>
  );
}

/** A side-column list (who to follow, your agenda) with its rows hatched. */
export function AsideListSkeleton({
  title,
  rows = 3,
  avatar = true,
}: {
  title: string;
  rows?: number;
  avatar?: boolean;
}) {
  return (
    <TitledPanel title={title}>
      <ul aria-hidden className={avatar ? "flex flex-col gap-1 p-2" : "flex flex-col gap-3 px-3.5 py-3"}>
        {Array.from({ length: rows }, (_, i) =>
          avatar ? (
            <li key={i} className="flex items-center gap-2.5 rounded-lg p-2">
              <Skeleton shape="circle" className="h-[30px] w-[30px]" row={i} />
              <span className="flex min-w-0 flex-1 flex-col gap-[7px]">
                <Skeleton className="h-[9px]" row={i} style={{ width: skeletonWidth(i + 11, 45, 70) }} />
                <Skeleton className="h-[7px]" row={i} style={{ width: skeletonWidth(i + 21, 55, 85) }} />
              </span>
            </li>
          ) : (
            <li key={i} className="flex items-start gap-2.5">
              <Skeleton className="mt-[3px] h-[7px] w-[44px]" row={i} />
              <span className="flex min-w-0 flex-1 flex-col gap-[7px] py-[3px]">
                <Skeleton className="h-[9px]" row={i} style={{ width: skeletonWidth(i + 31, 60, 92) }} />
                <Skeleton className="h-[7px]" row={i} style={{ width: skeletonWidth(i + 41, 35, 55) }} />
              </span>
            </li>
          ),
        )}
      </ul>
    </TitledPanel>
  );
}

/** The left rail with its counts and the profile card hatched. */
function RailSkeleton() {
  const t = useTranslations("publish");

  const views = FEED_VIEWS.map((view, i) => (
    <span
      key={view}
      className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-[13.5px] ${
        i === 0
          ? "bg-accent-primary/10 font-semibold text-accent-primary ring-1 ring-inset ring-accent-primary/20"
          : "text-fg-secondary"
      }`}
    >
      <span className="flex-1">{t(`views.${view}`)}</span>
      <Skeleton className="h-[7px] w-3" row={i} tone={i === 0 ? "yours" : undefined} />
    </span>
  ));

  return (
    <>
      <div aria-hidden className="flex flex-col gap-2 lg:hidden">
        <div className="-mx-1 flex gap-1 overflow-hidden px-1 pb-1">{views}</div>
        <span className="flex h-control-md items-center rounded-lg border border-border-medium px-3 text-[13px] text-fg-secondary">
          {t("filters")}
        </span>
      </div>

      <aside aria-hidden className="hidden flex-col gap-4 lg:flex lg:self-start lg:pr-1">
        <Panel className="flex flex-col gap-3">
          <span className="flex items-center gap-3">
            <Skeleton shape="circle" className="h-[38px] w-[38px]" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-[9px] w-[60%]" />
              <Skeleton className="h-[7px] w-[80%]" />
            </span>
          </span>
          <span className="grid grid-cols-3 gap-2">
            {(["going", "maybe", "hosting"] as const).map((key) => (
              <span key={key} className="flex flex-col gap-1.5">
                <Skeleton shape="title" className="h-[14px] w-5" row={1} />
                <Stamp className="text-[9.5px] tracking-[0.12em]">{t(`views.${key}`)}</Stamp>
              </span>
            ))}
          </span>
        </Panel>

        <div className="flex flex-col gap-0.5">{views}</div>

        <Panel className="flex flex-col gap-2.5">
          <Stamp className="tracking-[0.14em]">{t("filterByTopic")}</Stamp>
          <span className="flex flex-wrap gap-1.5">
            {TOPICS.map((topic) => (
              <span
                key={topic}
                className="kairos-mono rounded-lg bg-bg-tertiary px-2.5 py-1.5 text-[11px] text-fg-secondary"
              >
                {t(`topics.${topic}`)}
              </span>
            ))}
          </span>
        </Panel>
      </aside>
    </>
  );
}

/** The composer, as it looks: real labels, nothing wired. */
function ComposerSkeleton() {
  const t = useTranslations("publish");
  const chip =
    "flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 text-xs text-fg-tertiary";

  return (
    <div aria-hidden className="rounded-xl border border-border-medium bg-bg-elevated p-4">
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" className="h-9 w-9" />
        <span className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-border-medium bg-bg-secondary px-3 text-sm text-fg-tertiary">
          <span className="truncate">{t("composerPlaceholder")}</span>
        </span>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <span className={chip}>
          <CalendarDays size={13} className="text-accent-primary" />
          {t("dateTime")}
        </span>
        <span className={chip}>
          <MapPin size={13} className="text-accent-primary" />
          {t("addLocation")}
        </span>
        <span className={chip}>
          <ImagePlus size={13} className="text-accent-primary" />
          {t("coverImage")}
        </span>
        <span className="flex-1" />
        <span className="hidden items-center gap-1.5 sm:flex">
          <Users size={12} className="text-fg-quaternary" />
          <Stamp className="tracking-[0.14em]">{t("audiencePublic")}</Stamp>
        </span>
        <span className="flex h-8 items-center rounded-lg border border-border-medium px-4 text-xs font-semibold text-fg-tertiary">
          {t("continue")}
        </span>
      </div>
    </div>
  );
}

/** The whole /publish page, for the route's `loading.tsx`. */
export function PublishLoadingView() {
  const t = useTranslations("publish");
  const ts = useTranslations("skeleton");

  return (
    <>
      <SkeletonStatus label={ts("status")} />
      <TopBar
        actions={
          <span
            aria-hidden
            className="flex h-control-md items-center gap-2 rounded-lg border border-border-medium px-3.5 text-[13px] font-semibold text-fg-tertiary"
          >
            <CalendarPlus size={15} />
            <span className="hidden sm:inline">{t("publishEvent")}</span>
          </span>
        }
      />

      <div className="kairos-bottomnav-gap mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-4 pt-6 sm:px-6 sm:pt-8 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-8 lg:px-8 xl:grid-cols-[264px_minmax(0,1fr)_304px]">
        <RailSkeleton />

        <section className="flex min-w-0 flex-col gap-4">
          <ComposerSkeleton />

          <div aria-hidden className="flex flex-wrap items-center gap-2">
            <span className="flex shrink-0 gap-0.5 rounded-lg bg-bg-tertiary p-0.5">
              {(["following", "discover"] as const).map((source, i) => (
                <span
                  key={source}
                  className={`kairos-stamp rounded-md px-3 py-1.5 text-[10px] tracking-[0.12em] ${
                    i === 0
                      ? "bg-white text-accent-primary shadow-sm dark:bg-white/10"
                      : "text-fg-tertiary"
                  }`}
                >
                  {t(`sources.${source}`)}
                </span>
              ))}
            </span>
            <span className="relative flex h-control-md min-w-0 flex-1 items-center rounded-lg border border-border-medium bg-bg-secondary pl-8 pr-8 text-[13px] text-fg-tertiary">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-quaternary"
              />
              <span className="truncate">{t("searchPlaceholder")}</span>
            </span>
          </div>

          <FeedSkeleton count={3} />
        </section>

        <aside aria-hidden className="hidden flex-col gap-4 xl:flex xl:self-start">
          <AsideListSkeleton title={t("whoToFollow")} rows={4} />
          <AsideListSkeleton title={t("yourAgenda")} rows={3} avatar={false} />
        </aside>
      </div>
    </>
  );
}

/** The host-stats dialog body while `getHostStats` is in flight. */
export function EventProgressSkeleton() {
  const t = useTranslations("publish");
  return (
    <div aria-hidden>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-2 rounded-xl bg-accent-primary/5 p-3 dark:bg-white/5"
          >
            <Skeleton shape="circle" className="h-[15px] w-[15px]" row={0} />
            <Skeleton shape="title" className="h-[16px] w-8" row={0} />
            <Skeleton className="h-[6px] w-12" row={0} />
          </div>
        ))}
      </div>
      <h3 className="mb-2.5 mt-5 text-[13px] font-semibold text-fg-primary">{t("yourEvents")}</h3>
      <ol className="flex flex-col gap-3.5">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <span className="flex flex-col gap-[7px] pl-6">
              <Skeleton className="h-[9px]" row={i + 1} style={{ width: skeletonWidth(i + 51, 40, 70) }} />
              <Skeleton className="h-[7px]" row={i + 1} style={{ width: skeletonWidth(i + 61, 30, 50) }} />
            </span>
            <Skeleton shape="circle" className="h-1.5 w-full" row={i + 1} />
          </li>
        ))}
      </ol>
    </div>
  );
}
