"use client";

/**
 * The publish surface: rail, feed, aside.
 *
 * ## What this owns
 *
 * Everything that decides *what is on screen*. The panes below are given their
 * data; the rules for choosing it live on the server now, in `event.getFeed`.
 *
 * ## Why the query moved
 *
 * The feed used to fetch every row and filter them in the browser, which made
 * the views lie: "Going" filtered whatever the cursor had handed over, so it
 * showed three events until you paged far enough forward. Source, view, region,
 * topic and search are all `where` clauses now, and one server page is one feed
 * page — so a page is full, and page 4 of "Going in Varna" means what it says.
 *
 * ## What lives in the URL
 *
 * Source, view, region, topic, search and page. All six, because every one of
 * them changes what a person is looking at, and a feed you cannot send someone
 * is not a feed you can talk about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { AlertCircle, CalendarPlus, Loader2, Search, X } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useSocketEvent } from "~/hooks/useSocketEvent";
import { TopBar } from "~/components/layout/TopBar";
import {
  CreateEventForm,
  type ComposerField,
} from "~/components/events/CreateEventForm";

import { EventCard } from "./EventCard";
import { EventComposer } from "./EventComposer";
import { EventProgressButton } from "./EventProgress";
import { FeedPager } from "./FeedPager";
import { PublishAside } from "./PublishAside";
import { PublishRail, type RailCounts } from "./PublishRail";
import { BandDivider } from "./publishUi";
import { FEED_PAGE_SIZE } from "./eventMutations";
import {
  bandRows,
  isFeedSource,
  isFeedView,
  isRegion,
  isTopic,
  regionLabel,
  type FeedSource,
  type FeedView,
  type REGIONS,
} from "./feedData";

interface ComposerDraft {
  title: string;
  focus: ComposerField;
}

/** How long a keystroke waits before it becomes a query. */
const SEARCH_DEBOUNCE_MS = 300;

export function PublishWorkspace() {
  const t = useTranslations("publish");
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const utils = api.useUtils();

  const rawSource = params.get("source");
  /**
   * Discover unless you asked for Following.
   *
   * Defaulting a signed-in visitor into Following put everybody who had not
   * followed anyone yet — which is everybody, on the day this shipped — on an
   * empty screen with three events one tab away. Following is now somewhere you
   * go, not somewhere you land.
   */
  const source: FeedSource = isFeedSource(rawSource) ? rawSource : "discover";
  const view: FeedView = isFeedView(params.get("view"))
    ? (params.get("view") as FeedView)
    : "all";
  /* `isRegion` has already checked this against the enum; the cast is what
     carries that fact into the query input's type. */
  const region = (
    isRegion(params.get("region")) ? params.get("region")! : ""
  ) as "" | (typeof REGIONS)[number]["value"];
  const topicParam = params.get("topic");
  const topic = isTopic(topicParam) ? topicParam : null;
  const query = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const deepLinkedId = Number(params.get("event")) || null;

  const [draft, setDraft] = useState<ComposerDraft | null>(null);

  /* The input is local and the URL lags it, so typing stays smooth and the back
     button gets one entry per search rather than one per keystroke. */
  const [searchText, setSearchText] = useState(query);
  useEffect(() => setSearchText(query), [query]);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === "all" || value === "1") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const search = next.toString();
      router.replace(search ? `/publish?${search}` : "/publish", {
        scroll: false,
      });
    },
    [params, router],
  );

  /** Any change to what is being selected drops you back to page one. */
  const setFilter = useCallback(
    (patch: Record<string, string | null>) => setParams({ ...patch, page: "1" }),
    [setParams],
  );

  useEffect(() => {
    if (searchText === query) return;
    const timer = setTimeout(
      () => setFilter({ q: searchText.trim() || null }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchText, query, setFilter]);

  /** A `/publish?event=12` link predates the event page. Send it there. */
  useEffect(() => {
    if (deepLinkedId) router.replace(`/events/${deepLinkedId}`);
  }, [deepLinkedId, router]);

  const feedInput = useMemo(
    () => ({
      source,
      view,
      region: region || null,
      topic,
      query: query || null,
      limit: FEED_PAGE_SIZE,
    }),
    [source, view, region, topic, query],
  );

  const {
    data: pages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = api.event.getFeed.useInfiniteQuery(feedInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const { data: summary } = api.event.getMySummary.useQuery(undefined, {
    enabled: !!session,
  });

  const { data: facets } = api.event.getFacets.useQuery({
    source,
    query: query || null,
    region: region || null,
    topic,
  });

  const loadedPages = useMemo(() => pages?.pages ?? [], [pages?.pages]);
  /* One server page is one feed page, so the pager counts what has arrived and
     the `+` on the end says the server has more. */
  const pageCount = Math.max(1, loadedPages.length);
  const safePage = Math.min(page, pageCount);
  const current = loadedPages[safePage - 1];
  const rows = useMemo(() => bandRows(current?.items ?? []), [current?.items]);
  const isEmpty = loadedPages.length > 0 && loadedPages[0]?.items.length === 0;

  /* Reading forward past what is loaded pulls the next cursor. */
  useEffect(() => {
    if (page <= loadedPages.length) return;
    if (!hasNextPage || isFetchingNextPage || isLoading) return;
    void fetchNextPage();
  }, [
    page,
    loadedPages.length,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
  ]);

  const feedTopRef = useRef<HTMLDivElement | null>(null);
  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.max(
        1,
        hasNextPage ? next : Math.min(next, pageCount),
      );
      setParams({ page: String(clamped) });
      feedTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [hasNextPage, pageCount, setParams],
  );

  /**
   * The rail's counts come from the server, over the whole table rather than
   * the loaded page — a paged feed would otherwise report "1 going" until you
   * paged forward far enough to find the second one.
   */
  const counts: RailCounts = useMemo(
    () => ({
      all: facets?.total ?? 0,
      going: summary?.counts.going ?? 0,
      maybe: summary?.counts.maybe ?? 0,
      hosting: summary?.counts.hosting ?? 0,
      saved: summary?.counts.saved ?? 0,
      past: summary?.counts.past ?? 0,
      followers: summary?.counts.followers ?? 0,
      following: summary?.counts.following ?? 0,
    }),
    [facets?.total, summary],
  );

  /* Real time. `event:created` is new — creation used to emit nothing at all,
     so the one moment a live feed exists for was the one it sat still for. */
  const refreshFeed = useCallback(() => {
    void utils.event.getFeed.invalidate();
    void utils.event.getFacets.invalidate();
  }, [utils.event.getFeed, utils.event.getFacets]);

  useSocketEvent("event:created", refreshFeed);
  useSocketEvent("event:updated", refreshFeed);
  useSocketEvent("event:deleted", refreshFeed);

  const viewerId = session?.user?.id ?? null;

  const feedBody = () => {
    if (isLoading) {
      return (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-accent-primary" />
          <p className="text-sm text-fg-secondary">{t("loadingEvents")}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="py-20 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent-primary/20">
            <AlertCircle size={30} className="text-accent-primary" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-fg-primary">
            {t("errorLoadingEvents")}
          </h2>
          <p className="text-sm text-fg-secondary">{error.message}</p>
        </div>
      );
    }

    if (isEmpty) {
      /* An empty Following lane is not an empty app — it means you have not
         followed anybody yet and are hosting nothing yourself, and the way out
         is Discover, not a new event. This is the only thing that happens now:
         the server used to quietly swap the lane for Discover, so the screen
         below was the rare case rather than the first one everybody sees. */
      const emptyBody =
        source === "following"
          ? t("noEventsFollowing")
          : query
            ? t("noEventsSearch", { query })
            : region
              ? t("noEventsRegion", { region: regionLabel(region) })
              : t("noEventsDefault");

      return (
        <div className="px-4 py-20 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent-primary/10">
            <CalendarPlus size={30} className="text-accent-primary" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-fg-primary">
            {t("noEventsTitle")}
          </h2>
          <p className="text-sm text-fg-secondary">{emptyBody}</p>

          {/* An empty feed is usually not an empty app. The two ways out are
              the other lane and the archive, and which one is worth offering
              depends on why it came back empty. */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {source === "following" && (
              <button
                type="button"
                onClick={() => setFilter({ source: "discover" })}
                className="h-9 rounded-lg bg-accent-primary px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t("sources.discover")}
              </button>
            )}
            {view !== "past" && counts.past > 0 && (
              <button
                type="button"
                onClick={() => setFilter({ view: "past" })}
                className="h-9 rounded-lg border border-slate-200 px-4 text-[13px] font-semibold text-fg-secondary transition-colors hover:border-accent-primary/40 hover:text-accent-primary dark:border-white/10"
              >
                {t("browsePast", { count: counts.past })}
              </button>
            )}
          </div>
        </div>
      );
    }

    if (!current) {
      return (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-accent-primary" />
          <p className="text-sm text-fg-secondary">{t("loadingMoreEvents")}</p>
        </div>
      );
    }

    return (
      <>
        {/* Keyed on the page so a page turn plays the entrance once, together,
            rather than one card at a time as they scroll past. */}
        <div key={safePage} className="flex flex-col gap-4">
          {rows.map((row, index) => (
            <div key={row.event.id} className="flex flex-col gap-4">
              {(index === 0 || rows[index - 1]?.band !== row.band) && (
                <BandDivider
                  label={t("bands." + row.band)}
                  accent={row.band === "thisWeek"}
                />
              )}
              <EventCard
                event={{
                  ...row.event,
                  isOwner: viewerId === row.event.createdById,
                }}
              />
            </div>
          ))}
        </div>

        <FeedPager
          page={safePage}
          pageCount={pageCount}
          hasMore={!!hasNextPage}
          isLoadingMore={isFetchingNextPage}
          onChange={goToPage}
        />

        {!hasNextPage && safePage >= pageCount && (
          <p className="py-2 text-center text-sm text-fg-tertiary">
            {t("allCaughtUp")}
          </p>
        )}
      </>
    );
  };

  return (
    <>
      <TopBar
        actions={
          session ? (
            <button
              type="button"
              onClick={() => setDraft({ title: "", focus: "title" })}
              className="flex h-9 items-center gap-2 rounded-lg bg-accent-primary px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              <CalendarPlus size={15} />
              <span className="hidden sm:inline">{t("publishEvent")}</span>
            </button>
          ) : null
        }
      />

      {/* Fixed-width rails and a feed that takes everything left over — the old
          12-column split spent a quarter of the page on two panels of links. */}
      <main
        id="main-content"
        className="kairos-bottomnav-gap mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-4 pt-6 sm:px-6 sm:pt-8 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-8 lg:px-8 xl:grid-cols-[264px_minmax(0,1fr)_304px]"
      >
        <PublishRail
          view={view}
          onViewChange={(next) => setFilter({ view: next })}
          counts={counts}
          region={region}
          onRegionChange={(next) => setFilter({ region: next || null })}
          regionTotals={facets?.regions ?? {}}
          topic={topic}
          onTopicChange={(next) => setFilter({ topic: next })}
          topicTotals={facets?.topics ?? {}}
        />

        <section className="flex min-w-0 flex-col gap-4">
          <EventComposer onOpen={setDraft} />

          {/* The feed's toolbar: whose events, which ones, and the way into the
              engagement summary. */}
          <div
            ref={feedTopRef}
            className="flex scroll-mt-24 flex-wrap items-center gap-2"
          >
            {session && (
              <div
                role="group"
                aria-label={t("feedSource")}
                className="flex shrink-0 gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-white/5"
              >
                {(["following", "discover"] as const).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setFilter({ source: candidate })}
                    aria-pressed={source === candidate}
                    className={`kairos-stamp rounded-md px-3 py-1.5 text-[10px] tracking-[0.12em] transition-colors ${
                      source === candidate
                        ? "bg-white text-accent-primary shadow-sm dark:bg-white/10"
                        : "text-fg-tertiary hover:text-fg-secondary"
                    }`}
                  >
                    {t("sources." + candidate)}
                  </button>
                ))}
              </div>
            )}

            <div className="relative min-w-0 flex-1">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-quaternary"
              />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 text-[13px] text-fg-primary placeholder:text-fg-tertiary focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/40 dark:border-white/10 dark:bg-white/5"
              />
              {searchText && (
                <button
                  type="button"
                  onClick={() => setSearchText("")}
                  aria-label={t("clearSearch")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-quaternary transition-colors hover:text-fg-primary"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <EventProgressButton />
          </div>

          {feedBody()}
        </section>

        <PublishAside />
      </main>

      {draft &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl dark:border-white/5 dark:bg-[#1A191E]">
              <CreateEventForm
                initialTitle={draft.title}
                focusField={draft.focus}
                onSuccess={() => setDraft(null)}
                onClose={() => setDraft(null)}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
