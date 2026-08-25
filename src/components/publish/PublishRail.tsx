"use client";

/**
 * The left rail: who you are here, and the ways into the feed.
 *
 * The old left column held one thing — a region dropdown — and vanished below
 * `lg`, taking the only filter with it. This rail carries the identity card,
 * the views, and the region picker, and collapses into a scrolling strip of the
 * same views on small screens rather than disappearing.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { ChevronDown, MapPin } from "lucide-react";

import { FEED_VIEWS, REGIONS, regionLabel, type FeedView } from "./feedData";
import { Panel, PersonAvatar, Stamp } from "./publishUi";

export interface RailCounts {
  all: number;
  going: number;
  maybe: number;
  hosting: number;
  past: number;
}

function ProfileCard({ counts }: { counts: RailCounts }) {
  const t = useTranslations("publish");
  const { data: session } = useSession();

  if (!session?.user) return null;

  const stats = [
    { label: t("views.going"), value: counts.going, accent: false },
    { label: t("views.maybe"), value: counts.maybe, accent: false },
    { label: t("views.hosting"), value: counts.hosting, accent: true },
  ];

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PersonAvatar
          name={session.user.name}
          image={session.user.image}
          size="lg"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-fg-primary">
            {session.user.name ?? session.user.email}
          </span>
          <Stamp className="normal-case tracking-normal">
            {session.user.email}
          </Stamp>
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-0.5">
            <dd
              className={`kairos-mono text-base font-semibold ${
                stat.accent ? "text-accent-primary" : "text-fg-primary"
              }`}
            >
              {stat.value}
            </dd>
            <dt>
              <Stamp className="text-[9.5px] tracking-[0.12em]">
                {stat.label}
              </Stamp>
            </dt>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function ViewButton({
  view,
  active,
  count,
  onSelect,
}: {
  view: FeedView;
  active: boolean;
  count: number;
  onSelect: (view: FeedView) => void;
}) {
  const t = useTranslations("publish");

  return (
    <button
      type="button"
      onClick={() => onSelect(view)}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center justify-between gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-[13.5px] transition-colors ${
        active
          ? "bg-accent-primary/10 font-semibold text-fg-primary"
          : "text-fg-secondary hover:bg-slate-100 dark:hover:bg-white/5"
      }`}
    >
      <span>{t(`views.${view}`)}</span>
      <span
        className={`kairos-mono text-[11px] ${
          active ? "text-accent-primary" : "text-fg-quaternary"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export function PublishRail({
  view,
  onViewChange,
  counts,
  region,
  onRegionChange,
  regionTotals,
}: {
  view: FeedView;
  onViewChange: (view: FeedView) => void;
  counts: RailCounts;
  region: string;
  onRegionChange: (region: string) => void;
  /** How many loaded events sit in each region, for the picker's counts. */
  regionTotals: Record<string, number>;
}) {
  const t = useTranslations("publish");

  const views = (
    <>
      {FEED_VIEWS.map((candidate) => (
        <ViewButton
          key={candidate}
          view={candidate}
          active={view === candidate}
          count={counts[candidate]}
          onSelect={onViewChange}
        />
      ))}
    </>
  );

  return (
    <>
      {/* Small screens: the views as a scrolling strip, above the feed. */}
      <nav
        aria-label={t("feedViews")}
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-hide lg:hidden"
      >
        {views}
      </nav>

      <aside className="dash-rise hidden flex-col gap-4 lg:flex lg:col-span-3">
        <ProfileCard counts={counts} />

        <nav aria-label={t("feedViews")} className="flex flex-col gap-0.5">
          {views}
        </nav>

        <Panel className="flex flex-col gap-2.5">
          <Stamp className="tracking-[0.14em]">{t("filterByTowns")}</Stamp>
          <div className="relative">
            <MapPin
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-accent-primary"
            />
            <select
              value={region}
              onChange={(event) => onRegionChange(event.target.value)}
              aria-label={t("filterByTowns")}
              className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 text-[13px] text-fg-primary focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/40 dark:border-accent-primary/25 dark:bg-white/5"
            >
              {REGIONS.map((option) => {
                const total =
                  option.value === ""
                    ? undefined
                    : (regionTotals[option.value] ?? 0);
                return (
                  <option
                    key={option.value || "all"}
                    value={option.value}
                    className="bg-white text-slate-800 dark:bg-[#16151A] dark:text-gray-200"
                  >
                    {option.value === "" ? t("allRegions") : option.label}
                    {total ? ` · ${total}` : ""}
                  </option>
                );
              })}
            </select>
            <ChevronDown
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-accent-primary"
            />
          </div>
          <p className="text-xs leading-relaxed text-fg-tertiary">
            {region === ""
              ? t("regionHintAll")
              : t("regionHint", { region: regionLabel(region) })}
          </p>
        </Panel>

        <Panel className="flex flex-col gap-2 border-slate-200 bg-slate-50 dark:bg-[#0c0c11]">
          <Stamp className="tracking-[0.14em]">{t("messages")}</Stamp>
          <p className="text-xs leading-relaxed text-fg-tertiary">
            {t("messagesHint")}
          </p>
          <Link
            href="/chat"
            className="text-xs font-semibold text-accent-primary hover:text-accent-hover"
          >
            {t("openChat")} →
          </Link>
        </Panel>
      </aside>
    </>
  );
}
