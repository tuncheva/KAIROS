"use client";

/**
 * Optimistic writes against the feed cache.
 *
 * Likes, saves and RSVPs are the three things people press repeatedly, so all
 * three paint immediately and roll the cache back on failure.
 *
 * The wrinkle a paged, filtered feed adds: there is no longer one cache key to
 * patch. `event.getFeed` is keyed by source, view, region, topic and search, so
 * the same event can be sitting in several cached lanes at once — press Going
 * in Discover and the row in Following must move too. `patchEverywhere` walks
 * every cached `getFeed` page rather than assuming a single key, which is why
 * these hooks talk to the query client directly instead of through the typed
 * `setInfiniteData` helper for one input.
 */

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useCallback } from "react";

import { api } from "~/trpc/react";
import type { FeedEvent } from "./feedData";

/** How many cards one page of the feed holds. */
export const FEED_PAGE_SIZE = 8;

interface FeedPage {
  items: FeedEvent[];
  nextCursor: { eventDate: Date; id: number } | null;
}

interface InfiniteFeed {
  pages: FeedPage[];
  pageParams: unknown[];
}

function isInfiniteFeed(value: unknown): value is InfiniteFeed {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as InfiniteFeed).pages)
  );
}

/**
 * Apply `patch` to one event wherever it is cached.
 *
 * `predicate: false` on the key match means "every cached input for this
 * procedure", which is exactly what we want: one press, every lane.
 */
function useFeedPatcher() {
  const queryClient = useQueryClient();

  return useCallback(
    (eventId: number, patch: (event: FeedEvent) => FeedEvent) => {
      const key = getQueryKey(api.event.getFeed);
      const snapshots: Array<[readonly unknown[], unknown]> = [];

      queryClient.setQueriesData({ queryKey: key }, (old: unknown) => {
        if (!isInfiniteFeed(old)) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((event) =>
              event.id === eventId ? patch(event) : event,
            ),
          })),
        };
      });

      queryClient
        .getQueryCache()
        .findAll({ queryKey: key })
        .forEach((query) => {
          snapshots.push([query.queryKey, query.state.data]);
        });

      return snapshots;
    },
    [queryClient],
  );
}

/** Put the cache back the way it was, after a write the server refused. */
function useFeedRestorer() {
  const queryClient = useQueryClient();

  return useCallback(
    (snapshots: Array<[readonly unknown[], unknown]>) => {
      for (const [key, data] of snapshots) {
        queryClient.setQueryData(key, data);
      }
    },
    [queryClient],
  );
}

/** Snapshot every cached feed page before an optimistic write. */
function useFeedSnapshot() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    const key = getQueryKey(api.event.getFeed);
    return queryClient
      .getQueryCache()
      .findAll({ queryKey: key })
      .map(
        (query) =>
          [query.queryKey, query.state.data] as [readonly unknown[], unknown],
      );
  }, [queryClient]);
}

export function useOptimisticLike(eventId: number) {
  const queryClient = useQueryClient();
  const patch = useFeedPatcher();
  const snapshot = useFeedSnapshot();
  const restore = useFeedRestorer();

  return api.event.toggleLike.useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: getQueryKey(api.event.getFeed),
      });
      const previous = snapshot();

      patch(eventId, (event) => ({
        ...event,
        hasLiked: !event.hasLiked,
        likeCount: event.likeCount + (event.hasLiked ? -1 : 1),
      }));

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) restore(context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: getQueryKey(api.event.getById),
      });
    },
  });
}

/**
 * Bookmarking, which is not attending.
 *
 * Saves are private, so unlike a like there is no count anywhere to keep in
 * step — only the viewer's own flag.
 */
export function useOptimisticSave(eventId: number) {
  const queryClient = useQueryClient();
  const patch = useFeedPatcher();
  const snapshot = useFeedSnapshot();
  const restore = useFeedRestorer();

  return api.event.toggleSave.useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: getQueryKey(api.event.getFeed),
      });
      const previous = snapshot();

      patch(eventId, (event) => ({ ...event, hasSaved: !event.hasSaved }));

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) restore(context.previous);
    },
  });
}

export function useOptimisticRsvp(eventId: number) {
  const queryClient = useQueryClient();
  const utils = api.useUtils();
  const patch = useFeedPatcher();
  const snapshot = useFeedSnapshot();
  const restore = useFeedRestorer();

  return api.event.updateRsvp.useMutation({
    onMutate: async ({ status }) => {
      await queryClient.cancelQueries({
        queryKey: getQueryKey(api.event.getFeed),
      });
      const previous = snapshot();

      patch(eventId, (event) => {
        const counts = { ...event.rsvpCounts };
        const key = (value: "going" | "maybe" | "not_going") =>
          value === "not_going" ? ("notGoing" as const) : value;

        if (event.userRsvpStatus) counts[key(event.userRsvpStatus)] -= 1;
        counts[key(status)] += 1;

        return { ...event, userRsvpStatus: status, rsvpCounts: counts };
      });

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) restore(context.previous);
    },
    onSettled: () => {
      /* The rail's counts come from the server, and an RSVP is exactly what
         moves them. */
      void utils.event.getMySummary.invalidate();
      void queryClient.invalidateQueries({
        queryKey: getQueryKey(api.event.getById),
      });
    },
  });
}

/**
 * Deleting removes the row from every cached lane at once.
 *
 * Unlike the three above this is not reversible in the cache — a failed delete
 * refetches rather than restoring, because by then the socket may have told us
 * something else about the row anyway.
 */
export function useOptimisticDelete(
  eventId: number,
  handlers: { onError?: (message: string) => void; onSuccess?: () => void } = {},
) {
  const queryClient = useQueryClient();
  const utils = api.useUtils();

  return api.event.deleteEvent.useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: getQueryKey(api.event.getFeed),
      });

      const key = getQueryKey(api.event.getFeed);
      const previous = queryClient
        .getQueryCache()
        .findAll({ queryKey: key })
        .map(
          (query) =>
            [query.queryKey, query.state.data] as [readonly unknown[], unknown],
        );

      queryClient.setQueriesData({ queryKey: key }, (old: unknown) => {
        if (!isInfiniteFeed(old)) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((event) => event.id !== eventId),
          })),
        };
      });

      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      handlers.onError?.(error.message);
    },
    onSuccess: () => {
      void utils.event.getMySummary.invalidate();
      handlers.onSuccess?.();
    },
  });
}
