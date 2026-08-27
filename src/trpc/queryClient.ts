import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * How long a result is trusted without going back to the server.
         *
         * This is the single biggest lever on how a page-to-page switch feels,
         * because navigating remounts every component on the destination page
         * and each one re-runs its queries. At 30s the common loop — dashboard,
         * projects, back to dashboard — spent most of its trips refetching data
         * that had not changed, and each page came up on a spinner it did not
         * need. A minute covers that loop while still being short enough that
         * anything stale is corrected on the next window focus.
         *
         * It is a floor, not a policy: queries that must be fresher (the
         * notification bell) or that are effectively immutable (the agent list)
         * still say so at the call site.
         */
        staleTime: 60 * 1000,
        /**
         * How long an *unused* result is kept before it is thrown away.
         *
         * The default is 5 minutes, which is short enough that leaving a page
         * open, wandering off and coming back drops the cache and reloads the
         * app from scratch. Keeping results for half an hour means the back
         * button and the nav rail stay instant across a whole working session;
         * the cost is only memory for data already fetched once.
         */
        gcTime: 30 * 60 * 1000,
        /**
         * Refetching on every focus was firing a burst of requests each time
         * the user alt-tabbed back, on every query the page had. Staleness is
         * already handled by `staleTime` above, and the surfaces that genuinely
         * need to catch up on return — notifications, chat — are push-driven
         * over the socket and opt back in individually.
         */
        refetchOnWindowFocus: false,
        /**
         * A dropped request should not cost the user three round-trips of
         * waiting before the page admits something went wrong.
         */
        retry: 1,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
