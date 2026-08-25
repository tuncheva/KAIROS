"use client";

/**
 * The publish surface: rail, feed, aside.
 *
 * The page used to own the query, the region state, two hand-rolled sidebars and
 * a 240-line feed component that also owned the composer. Everything that
 * decides *what is on screen* now lands here, the panes are given their data,
 * and the rules for filtering live in `feedData.ts` where they can be read.
 *
 * The view and region are in the URL, so a filtered feed is a link you can send
 * and the back button undoes a filter change instead of leaving the page.
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
import { PublishAside } from "./PublishAside";
import { PublishRail, type RailCounts } from "./PublishRail";
import { BandDivider } from "./publishUi";
import { FEED_QUERY_INPUT } from "./eventMutations";
import {
  isFeedView,
  regionCounts,
  regionLabel,
  selectFeed,
  splitByTime,
  type FeedEvent,
  type FeedView,
} from "./feedData";

interface ComposerDraft {
  title: string;
  focus: ComposerField;
}

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
  const deepLinkedId = Number(params.get("event")) || null;

  const [draft, setDraft] = useState<ComposerDraft | null>(null);

  /** View and region are URL state; replace rather than push so filters do not
      pile up in history one keystroke at a time. */
  const setParam = useCallback(
    (key: "view" | "region", value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
      const query = next.toString();
      router.replace(query ? `/publish?${query}` : "/publish", {
        scroll: false,
      });
    },
    [params, router],
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
    () => pages?.pages.flatMap((page) => page.items) ?? [],
    [pages?.pages],
  );

  const viewerId = session?.user?.id ?? null;

  const visible = useMemo(
    () => selectFeed({ events, view, region, query: "", viewerId }),
    [events, view, region, viewerId],
  );
  const bands = useMemo(() => splitByTime(visible), [visible]);
  const totals = useMemo(() => regionCounts(events), [events]);

  /**
   * The rail's counts come from the server for the three that depend on you —
   * a paginated feed would otherwise report "1 going" until you scrolled — and
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

  /* Infinite scroll. */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [sentinelVisible, setSentinelVisible] = useState(false);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => setSentinelVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!sentinelVisible || !hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [sentinelVisible, hasNextPage, isFetchingNextPage, fetchNextPage]);

  /* Real time. */
  const handleDeleted = useCallback(
    ({ eventId }: { eventId: number }) => {
      utils.event.getPublicEvents.setInfiniteData(FEED_QUERY_INPUT, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter((e) => e.id !== eventId),
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
   * A shared link (`/publish?event=12`) should land on the card. The row may be
   * on a later page, so this waits until it is actually rendered rather than
   * racing the first fetch with a timeout.
   */
  const scrolledToRef = useRef<number | null>(null);
  useEffect(() => {
    if (!deepLinkedId || scrolledToRef.current === deepLinkedId) return;
    const node = document.getElementById(`event-${deepLinkedId}`);
    if (!node) return;
    scrolledToRef.current = deepLinkedId;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [deepLinkedId, visible]);

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

    if (visible.length === 0) {
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

    let index = 0;

    return (
      <>
        {bands.upcoming.length > 0 && (
          <>
            <BandDivider label={t("bands.upcoming")} accent />
            {bands.upcoming.map((event) => (
              <EventCard
                key={event.id}
                delayMs={Math.min(160 + index++ * 60, 460)}
                event={{ ...event, isOwner: viewerId === event.createdById }}
              />
            ))}
          </>
        )}

        {bands.past.length > 0 && (
          <>
            <BandDivider label={t("bands.past")} />
            {bands.past.map((event) => (
              <EventCard
                key={event.id}
                delayMs={Math.min(160 + index++ * 60, 460)}
                event={{ ...event, isOwner: viewerId === event.createdById }}
              />
            ))}
          </>
        )}

        <div ref={sentinelRef} className="h-6" />

        {isFetchingNextPage && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto mb-2 h-7 w-7 animate-spin text-accent-primary" />
            <p className="text-sm text-fg-secondary">
              {t("loadingMoreEvents")}
            </p>
          </div>
        )}

        {!hasNextPage && (
          <p className="py-6 text-center text-sm text-fg-tertiary">
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

      <main
        id="main-content"
        className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 pb-28 pt-6 sm:px-6 sm:pb-8 sm:pt-8 lg:grid-cols-12 lg:gap-8 lg:px-8"
      >

        <PublishRail
          view={view}
          onViewChange={(next) => setParam("view", next)}
          counts={counts}
          region={region}
          onRegionChange={(next) => setParam("region", next)}
          regionTotals={totals}
        />

        <section className="flex flex-col gap-4 lg:col-span-6">
          <EventComposer onOpen={setDraft} />
          {feedBody()}
        </section>

        <PublishAside events={events} />
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
