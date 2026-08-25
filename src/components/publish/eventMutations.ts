"use client";

/**
 * Optimistic writes against the feed cache.
 *
 * Likes and RSVPs are the two things people press repeatedly, so both paint
 * immediately and roll the cache back on failure. All three hooks patch the
 * same infinite-query key the feed reads; `FEED_QUERY_INPUT` is that key in one
 * place so a page-size change cannot desynchronise the cache from the reader.
 */

import { api } from "~/trpc/react";

export const FEED_QUERY_INPUT = { limit: 10 } as const;

export function useOptimisticLike(eventId: number) {
  const utils = api.useUtils();

  return api.event.toggleLike.useMutation({
    onMutate: async () => {
      await utils.event.getPublicEvents.cancel();
      const previous =
        utils.event.getPublicEvents.getInfiniteData(FEED_QUERY_INPUT);

      utils.event.getPublicEvents.setInfiniteData(FEED_QUERY_INPUT, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((event) =>
              event.id === eventId
                ? {
                    ...event,
                    hasLiked: !event.hasLiked,
                    likeCount: event.likeCount + (event.hasLiked ? -1 : 1),
                  }
                : event,
            ),
          })),
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.event.getPublicEvents.setInfiniteData(
          FEED_QUERY_INPUT,
          context.previous,
        );
      }
    },
    onSettled: () => {
      void utils.event.getPublicEvents.invalidate();
    },
  });
}

export function useOptimisticRsvp(eventId: number) {
  const utils = api.useUtils();

  return api.event.updateRsvp.useMutation({
    onMutate: async ({ status }) => {
      await utils.event.getPublicEvents.cancel();
      const previous =
        utils.event.getPublicEvents.getInfiniteData(FEED_QUERY_INPUT);

      utils.event.getPublicEvents.setInfiniteData(FEED_QUERY_INPUT, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((event) => {
              if (event.id !== eventId) return event;

              const counts = { ...event.rsvpCounts };
              if (event.userRsvpStatus === "going") counts.going--;
              else if (event.userRsvpStatus === "maybe") counts.maybe--;
              else if (event.userRsvpStatus === "not_going") counts.notGoing--;

              if (status === "going") counts.going++;
              else if (status === "maybe") counts.maybe++;
              else if (status === "not_going") counts.notGoing++;

              return { ...event, userRsvpStatus: status, rsvpCounts: counts };
            }),
          })),
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.event.getPublicEvents.setInfiniteData(
          FEED_QUERY_INPUT,
          context.previous,
        );
      }
    },
    onSettled: () => {
      void utils.event.getPublicEvents.invalidate();
      // The rail counts and the agenda both key off your RSVPs.
      void utils.event.getMySummary.invalidate();
    },
  });
}

/** Drops the card out of the feed the moment its owner confirms the delete. */
export function useOptimisticDelete(
  eventId: number,
  handlers: { onError: (message: string) => void; onSuccess: () => void },
) {
  const utils = api.useUtils();

  return api.event.deleteEvent.useMutation({
    onMutate: async () => {
      await utils.event.getPublicEvents.cancel();
      const previous =
        utils.event.getPublicEvents.getInfiniteData(FEED_QUERY_INPUT);

      utils.event.getPublicEvents.setInfiniteData(FEED_QUERY_INPUT, (old) => {
        if (!old) return old;
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
    onError: (error, _variables, context) => {
      if (context?.previous) {
        utils.event.getPublicEvents.setInfiniteData(
          FEED_QUERY_INPUT,
          context.previous,
        );
      }
      handlers.onError(error.message);
    },
    onSuccess: handlers.onSuccess,
    onSettled: () => {
      void utils.event.getPublicEvents.invalidate();
      void utils.event.getMySummary.invalidate();
    },
  });
}
