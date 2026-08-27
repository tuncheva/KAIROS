import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { api } from "~/trpc/server";
import { EventPage } from "~/components/events/EventPage";

/**
 * An event, at its own address.
 *
 * ## Why this route exists at all
 *
 * Until now the only way to look at an event was `/publish?event=12`, which
 * scrolled a card into view inside a feed you had to be signed in to reach.
 * Nothing had a URL, so nothing could be sent to a group chat, previewed with
 * an image, or found by a search engine — which is the difference between an
 * events product and a members-only noticeboard.
 *
 * ## Why it is outside the app shell
 *
 * Deliberately not in the `(app)` route group. Most of the people who open this
 * link will not have an account, and greeting them with a sidebar of links they
 * cannot use is worse than greeting them with the event. `src/proxy.ts` lets
 * `/events/*` through the cookie gate for the same reason.
 *
 * The page itself is rendered on the server for its metadata and hydrated by a
 * client component for everything interactive.
 */

export const revalidate = 0;

function eventIdFrom(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const eventId = eventIdFrom(id);
  if (!eventId) return { title: "Event · KAIROS" };

  try {
    const { event } = await api.event.getById({ eventId });

    /* The description is the share preview, so it is trimmed at a word rather
       than mid-syllable — a preview ending "the exerc…" reads as broken. */
    const summary =
      event.description.length > 180
        ? `${event.description.slice(0, 180).replace(/\s+\S*$/, "")}…`
        : event.description;

    const when = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Sofia",
    }).format(event.eventDate);

    return {
      title: `${event.title} · KAIROS`,
      description: summary,
      openGraph: {
        title: event.title,
        description: `${when} · ${event.venue ?? event.region}\n\n${summary}`,
        type: "article",
        images: event.imageUrl ? [{ url: event.imageUrl }] : undefined,
      },
      twitter: {
        card: event.imageUrl ? "summary_large_image" : "summary",
        title: event.title,
        description: summary,
      },
    };
  } catch {
    /* A deleted event should render the not-found page, not a 500 in the
       metadata pass — the page body below decides that. */
    return { title: "Event · KAIROS" };
  }
}

export default async function EventRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eventId = eventIdFrom(id);
  if (!eventId) notFound();

  return <EventPage eventId={eventId} />;
}
