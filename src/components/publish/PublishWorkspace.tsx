"use client";

/**
 * The publish surface: rail, feed, aside.
 *
 * The page used to own the query, the region state, two hand-rolled sidebars and
 * a 240-line feed component that also owned the composer. Everything that
 * decides *what is on screen* now lands here, the panes are given their data,
 * and the rules for filtering live in `feedData.ts` where they can be read.
 *
 * The view, region and page are in the URL, so a filtered feed is a link you
 * can send and the back button undoes a filter change instead of leaving the
 * page.
 *
 * The feed is paged rather than infinite. Scrolling used to mount every event
 * ever loaded, each with its own staggered entrance firing as it crossed the
 * viewport, which is what made a long feed look the way it did; a page is a
 * fixed number of cards that arrive together and leave together. The server
 * still hands out cursors, so `fetchNextPage` runs underneath to keep enough
 * rows loaded for the page you are on — see `ensureLoaded` below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { AlertCircle, CalendarPlus, Loader2 } from "lucide-react";

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
import { FEED_QUERY_INPUT } from "./eventMutations";
import {
  isFeedView,
  orderForFeed,
  regionCounts,
  regionLabel,
  selectFeed,
  type FeedEvent,
  type FeedView,
} from "./feedData";

interface ComposerDraft {
  title: string;
  focus: ComposerField;
}

/** How many cards one page of the feed holds. */
const PAGE_SIZE = 8;

export function PublishWorkspace() {
  const t = useTranslations("publish");
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const utils = api.useUtils();

  const view: FeedView = isFeedView(params.get("view"))
    ? (params.get("view") as FeedView)
    : "all";
  const region = params.get("region") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const deepLinkedId = Number(params.get("event")) || null;

  const [draft, setDraft] = useState<ComposerDraft | null>(null);

  /**
   * View, region and page are URL state; replace rather than push so filters do
   * not pile up in history one keystroke at a time. Changing a filter drops you
   * back to page one — page 7 of the old feed is rarely page 7 of the new one.
   */
  const setParams = useCallback(
    (patch: Partial<Record<"view" | "region" | "page", string>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value && value !== "all" && value !== "1") next.set(key, value);
        else next.delete(key);
      }
      const query = next.toString();
      router.replace(query ? `/publish?${query}` : "/publish", {
        scroll: false,
      });
    },
    [params, router],
  );

  const setFilter = useCallback(
    (key: "view" | "region", value: string) =>
      setParams({ [key]: value, page: "1" }),
    [setParams],
  );

  const {
    data: pages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = api.event.getPublicEvents.useInfiniteQuery(FEED_QUERY_INPUT, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const { data: summary } = api.event.getMySummary.useQuery(undefined, {
    enabled: !!session,
  });

  const events = useMemo<FeedEvent[]>(
    () => pages?.pages.flatMap((serverPage) => serverPage.items) ?? [],
    [pages?.pages],
  );

  const viewerId = session?.user?.id ?? null;

  const visible = useMemo(
    () => selectFeed({ events, view, region, query: "", viewerId }),
    [events, view, region, viewerId],
  );

  /** The whole filtered feed in reading order, each row tagged with its band. */
  const ordered = useMemo(() => orderForFeed(visible), [visible]);
  const totals = useMemo(() => regionCounts(events), [events]);

  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const slice = useMemo(
    () => ordered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [ordered, safePage],
  );

  /**
   * Keep enough rows loaded to fill the page being read.
   *
   * The views filter client-side over what the cursor has handed us, so "going"
   * can throw away most of a server page. Rather than making the reader press
   * next through half-empty pages, this pulls the next cursor whenever the last
   * page is in sight and there is more to have.
   */
  const ensureLoaded = ordered.length < (safePage + 1) * PAGE_SIZE;
  useEffect(() => {
    if (!ensureLoaded || !hasNextPage || isFetchingNextPage || isLoading) return;
    void fetchNextPage();
  }, [ensureLoaded, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

  /** More to read beyond the pages we can already prove exist. */
  const hasMore = !!hasNextPage;

  /* Paging returns you to the top of the feed rather than mid-card. */
  const feedTopRef = useRef<HTMLDivElement | null>(null);
  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.max(1, hasMore ? next : Math.min(next, pageCount));
      setParams({ page: String(clamped) });
      feedTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [hasMore, pageCount, setParams],
  );

  /**
   * The rail's counts come from the server for the three that depend on you —
   * a paged feed would otherwise report "1 going" until you paged forward — and
   * from the loaded rows for the two that are only about what is on screen.
   */
  const counts: RailCounts = useMemo(() => {
    const inRegion = events.filter((e) => region === "" || e.region === region);
    const now = Date.now();
    return {
      all: inRegion.length,
      going: summary?.counts.going ?? 0,
      maybe: summary?.counts.maybe ?? 0,
      hosting: summary?.counts.hosting ?? 0,
      past: inRegion.filter((e) => new Date(e.eventDate).getTime() < now).length,
    };
  }, [events, region, summary]);

  /* Real time. */
  const handleDeleted = useCallback(
    ({ eventId }: { eventId: number }) => {
      utils.event.getPublicEvents.setInfiniteData(FEED_QUERY_INPUT, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((serverPage) => ({
                ...serverPage,
                items: serverPage.items.filter((e) => e.id !== eventId),
              })),
            }
          : old,
      );
    },
    [utils.event.getPublicEvents],
  );
  useSocketEvent("event:deleted", handleDeleted);

  const handleUpdated = useCallback(() => {
    void utils.event.getPublicEvents.invalidate();
  }, [utils.event.getPublicEvents]);
  useSocketEvent("event:updated", handleUpdated);

  /**
   * A shared link (`/publish?event=12`) should land on the card, which under
   * pagination first means landing on the *page* it is on. The row may still be
   * behind a cursor, so this waits until it is actually in `ordered` rather
   * than racing the first fetch with a timeout.
   */
  const scrolledToRef = useRef<number | null>(null);
  useEffect(() => {
    if (!deepLinkedId || scrolledToRef.current === deepLinkedId) return;

    const index = ordered.findIndex((row) => row.event.id === deepLinkedId);
    if (index === -1) return;

    const target = Math.floor(index / PAGE_SIZE) + 1;
    if (target !== safePage) {
      setParams({ page: String(target) });
      return;
    }

    const node = document.getElementById(`event-${deepLinkedId}`);
    if (!node) return;
    scrolledToRef.current = deepLinkedId;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [deepLinkedId, ordered, safePage, setParams]);

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

    if (ordered.length === 0) {
      /* Still pulling cursors for a filter that has not matched anything yet. */
      if (hasNextPage) {
        return (
          <div className="py-20 text-center">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-accent-primary" />
            <p className="text-sm text-fg-secondary">{t("loadingMoreEvents")}</p>
          </div>
        );
      }

      return (
        <div className="px-4 py-20 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent-primary/10">
            <CalendarPlus size={30} className="text-accent-primary" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-fg-primary">
            {t("noEventsTitle")}
          </h2>
          <p className="text-sm text-fg-secondary">
            {region
              ? t("noEventsRegion", { region: regionLabel(region) })
              : t("noEventsDefault")}
          </p>
        </div>
      );
    }

    return (
      <>
        {/* Keyed on the page so a page turn plays the entrance once, together,
            rather than one card at a time as they scroll past. */}
        <div key={safePage} className="flex flex-col gap-4">
          {slice.map((row, index) => (
            <div key={row.event.id} className="flex flex-col gap-4">
              {/* A band heading only where the band actually changes, so a page
                  sitting inside one band is not re-titled at the top. */}
              {(index === 0 || slice[index - 1]?.band !== row.band) && (
                <BandDivider
                  label={t("bands." + row.band)}
                  accent={row.band === "upcoming"}
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
          hasMore={hasMore}
          isLoadingMore={isFetchingNextPage}
          onChange={goToPage}
        />

        {!hasMore && safePage >= pageCount && (
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
        className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-4 pb-28 pt-6 sm:px-6 sm:pb-8 sm:pt-8 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-8 lg:px-8 xl:grid-cols-[264px_minmax(0,1fr)_304px]"
      >
        <PublishRail
          view={view}
          onViewChange={(next) => setFilter("view", next)}
          counts={counts}
          region={region}
          onRegionChange={(next) => setFilter("region", next)}
          regionTotals={totals}
        />

        <section className="flex min-w-0 flex-col gap-4">
          <EventComposer onOpen={setDraft} />

          {/* The feed's own toolbar: what you are looking at, how much of it,
              and the way into the engagement summary. */}
          <div
            ref={feedTopRef}
            className="flex scroll-mt-24 items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate text-[15px] font-semibold text-fg-primary">
                {t("views." + view)}
              </h1>
              {ordered.length > 0 && (
                <span className="kairos-mono shrink-0 text-[11px] text-fg-quaternary">
                  {t("pageOf", { page: safePage, pages: pageCount })}
                  {hasMore ? "+" : ""}
                </span>
              )}
            </span>
            <EventProgressButton events={visible} />
          </div>

          {feedBody()}
        </section>

        <PublishAside />
      </main>

      {draft &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl dark:border-white/5 dark:bg-[#1A191E]">
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
