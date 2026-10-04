import { EventPageSkeleton } from "~/components/events/EventPageSkeleton";

/**
 * Shown while the server resolves the event for its share metadata. The same
 * stand-in `EventPage` draws while its own query is in flight, so the hand-off
 * between the two is invisible.
 */
export default function EventLoading() {
  return <EventPageSkeleton />;
}
