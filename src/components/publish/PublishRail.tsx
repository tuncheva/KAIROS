"use client";

/**
 * The left rail: who you are here, and the ways into the feed.
 *
 * The region picker used to be a `<select>` counting whatever rows the browser
 * had loaded, which with a paged feed meant it was counting a screenful. Both
 * pickers are chips now, and both counts come from `event.getFacets` — over the
 * table, so "Varna 24" is a fact rather than a description of your scrolling.
 *
 * Chips rather than a dropdown for a reason beyond the counts: a dropdown hides
 * every option but one, so a person filtering by town cannot see that the town
 * next door has eleven events this week. That is the question the picker exists
 * to answer.
 */

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Clock,
  HelpCircle,
  Home,
  Megaphone,
  SlidersHorizontal,
} from "~/components/ui/icons";

import {
  FEED_VIEWS,
  REGIONS,
  TOPICS,
  regionLabel,
  type EventTopic,
  type FeedView,
} from "./feedData";
import { Panel, PersonAvatar, Stamp } from "./publishUi";

export interface RailCounts {
  all: number;
  going: number;
  maybe: number;
  hosting: number;
  saved: number;
  past: number;
  followers: number;
  following: number;
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
      <Link
        href={`/profile/${session.user.id}`}
        className="flex items-center gap-3 rounded-lg transition-opacity hover:opacity-80"
      >
        <PersonAvatar
          name={session.user.name}
          image={session.user.image}
          size="lg"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-fg-primary">
            {session.user.name ?? session.user.email}
          </span>
          {/* The follow graph, not the email address. On a page whose whole
              premise is who you follow, this is the line that belongs here —
              and the address is one you already know. */}
          <Stamp className="text-[9.5px] tracking-[0.12em]">
            {t("followLine", {
              followers: counts.followers,
              following: counts.following,
            })}
          </Stamp>
        </span>
      </Link>

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

/** One icon per way in, so the rail scans as a list of places rather than words. */
const VIEW_ICONS: Record<FeedView, typeof Home> = {
  all: Home,
  going: Check,
  maybe: HelpCircle,
  hosting: Megaphone,
  saved: Bookmark,
  past: Clock,
};

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
  const Icon = VIEW_ICONS[view];

  return (
    <button
      type="button"
      onClick={() => onSelect(view)}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-[13.5px] transition-colors ${
        active
          ? "bg-accent-primary/10 font-semibold text-accent-primary ring-1 ring-inset ring-accent-primary/20"
          : "text-fg-secondary hover:bg-slate-100 dark:hover:bg-white/5"
      }`}
    >
      <Icon
        size={15}
        aria-hidden="true"
        className={`shrink-0 ${active ? "text-accent-primary" : "text-fg-quaternary"}`}
      />
      <span className="flex-1">{t(`views.${view}`)}</span>
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

/** A filter chip. `count` is omitted where the facet query has nothing to say. */
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`kairos-mono flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
        active
          ? "bg-accent-primary/10 font-semibold text-accent-primary ring-1 ring-inset ring-accent-primary/30"
          : "bg-slate-100 text-fg-secondary hover:text-fg-primary dark:bg-white/5"
      }`}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className={active ? "text-accent-primary/70" : "text-fg-quaternary"}>
          {count}
        </span>
      )}
    </button>
  );
}

/** How many towns to show before the list folds. */
const REGIONS_SHOWN = 6;

export function PublishRail({
  view,
  onViewChange,
  counts,
  region,
  onRegionChange,
  regionTotals,
  topic,
  onTopicChange,
  topicTotals,
}: {
  view: FeedView;
  onViewChange: (view: FeedView) => void;
  counts: RailCounts;
  region: string;
  onRegionChange: (region: string) => void;
  /** How many upcoming events sit in each region, from the server. */
  regionTotals: Record<string, number>;
  topic: EventTopic | null;
  onTopicChange: (topic: EventTopic | null) => void;
  topicTotals: Record<string, number>;
}) {
  const t = useTranslations("publish");
  const [showAllRegions, setShowAllRegions] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

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

  const townChips = REGIONS.filter((option) => option.value !== "");
  const visibleTowns = showAllRegions
    ? townChips
    : townChips.slice(0, REGIONS_SHOWN);

  const filters = (
    <>
      <Panel className="flex flex-col gap-2.5">
        <Stamp className="tracking-[0.14em]">{t("filterByTowns")}</Stamp>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label={t("allRegions")}
            active={region === ""}
            onClick={() => onRegionChange("")}
          />
          {visibleTowns.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              count={regionTotals[option.value]}
              active={region === option.value}
              onClick={() =>
                onRegionChange(region === option.value ? "" : option.value)
              }
            />
          ))}
          {townChips.length > REGIONS_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAllRegions((open) => !open)}
              className="kairos-mono flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-accent-primary transition-colors hover:text-accent-hover"
            >
              {showAllRegions
                ? t("showFewer")
                : t("showMoreTowns", {
                    count: townChips.length - REGIONS_SHOWN,
                  })}
              <ChevronDown
                size={12}
                aria-hidden="true"
                className={showAllRegions ? "rotate-180" : ""}
              />
            </button>
          )}
        </div>
      </Panel>

      <Panel className="flex flex-col gap-2.5">
        <Stamp className="tracking-[0.14em]">{t("filterByTopic")}</Stamp>
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((candidate) => (
            <FilterChip
              key={candidate}
              label={t(`topics.${candidate}`)}
              count={topicTotals[candidate]}
              active={topic === candidate}
              onClick={() => onTopicChange(topic === candidate ? null : candidate)}
            />
          ))}
        </div>
      </Panel>
    </>
  );

  return (
    <>
      {/* Small screens: the views as a scrolling strip, and the filters behind
          one toggle. The rail vanishing below `lg` used to take the only filter
          with it, which is how a phone ended up with no way to pick a town. */}
      <div className="flex flex-col gap-2 lg:hidden">
        <nav
          aria-label={t("feedViews")}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-hide"
        >
          {views}
        </nav>

        <button
          type="button"
          onClick={() => setShowMobileFilters((open) => !open)}
          aria-expanded={showMobileFilters}
          className="flex h-9 items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 text-[13px] text-fg-secondary dark:border-white/10"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-accent-primary" />
            {t("filters")}
          </span>
          <span className="flex items-center gap-2">
            {(region || topic) && (
              <span className="kairos-mono text-[11px] text-accent-primary">
                {[region ? regionLabel(region) : null, topic ? t(`topics.${topic}`) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            <ChevronDown
              size={13}
              aria-hidden="true"
              className={showMobileFilters ? "rotate-180" : ""}
            />
          </span>
        </button>

        {showMobileFilters && <div className="flex flex-col gap-3">{filters}</div>}
      </div>

      <aside className="dash-rise hidden flex-col gap-4 scrollbar-hide lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <ProfileCard counts={counts} />

        <nav aria-label={t("feedViews")} className="flex flex-col gap-0.5">
          {views}
        </nav>

        {filters}

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
