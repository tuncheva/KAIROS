import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The bell, actually clicked.
 *
 * "The remind me button doesn't work" was reported twice, and both times the
 * evidence against it was a static read of the source — which cannot see a
 * handler that returns early, a picker whose render condition is never true, or
 * a toast that is never mounted. So this one mounts the card and presses the
 * button.
 *
 * The card is wired to tRPC and to the optimistic-mutation hooks, both of which
 * want a query client; they are stubbed, because none of this is about data.
 * What is under test is what a person sees after a click.
 */

const rsvpMutate = vi.fn();

vi.mock("~/components/publish/eventMutations", () => ({
  FEED_PAGE_SIZE: 8,
  useOptimisticLike: () => ({ mutate: vi.fn(), isPending: false }),
  useOptimisticSave: () => ({ mutate: vi.fn(), isPending: false }),
  useOptimisticRsvp: () => ({ mutate: rsvpMutate, isPending: false }),
  useOptimisticDelete: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "viewer", name: "Ada" } },
    status: "authenticated",
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EventCard } from "~/components/publish/EventCard";
import type { FeedEventForViewer } from "~/components/publish/feedData";

const HOUR = 60 * 60 * 1000;

function makeEvent(overrides: Partial<FeedEventForViewer> = {}): FeedEventForViewer {
  return {
    id: 1,
    title: "Component Systems Night",
    description: "Three short talks, then open floor.",
    eventDate: new Date(Date.now() + 48 * HOUR),
    endsAt: null,
    region: "sofia",
    venue: null,
    address: null,
    capacity: null,
    topic: null,
    coverTheme: null,
    imageUrl: null,
    createdAt: new Date(Date.now() - 72 * HOUR),
    updatedAt: null,
    createdById: "host",
    enableRsvp: true,
    commentCount: 0,
    likeCount: 0,
    hasLiked: false,
    hasSaved: false,
    userRsvpStatus: null,
    viewerFollowsAuthor: false,
    viewerCanEdit: false,
    isOwner: false,
    author: { id: "host", name: "Grace Hopper", image: null },
    rsvpCounts: { going: 3, maybe: 1, notGoing: 0 },
    attendees: [],
    reason: null,
    ...overrides,
  };
}

const bell = () => screen.getByRole("button", { name: /event notifications/i });

beforeEach(() => {
  rsvpMutate.mockClear();
});

describe("the Remind me bell", () => {
  it("warns instead of staying silent on an event that has already happened", () => {
    render(
      <EventCard
        event={makeEvent({
          eventDate: new Date(Date.now() - 48 * HOUR),
          userRsvpStatus: "going",
        })}
      />,
    );

    fireEvent.click(bell());

    expect(screen.getByRole("status")).toHaveTextContent(/already happened/i);
    expect(screen.queryByText(/Get notified before event/i)).not.toBeInTheDocument();
    expect(rsvpMutate).not.toHaveBeenCalled();
  });

  it("warns on a past event even when it never took RSVPs", () => {
    render(
      <EventCard
        event={makeEvent({
          eventDate: new Date(Date.now() - 48 * HOUR),
          enableRsvp: false,
        })}
      />,
    );

    fireEvent.click(bell());

    expect(screen.getByRole("status")).toHaveTextContent(/already happened/i);
  });

  it("opens the picker for someone who is going", () => {
    render(<EventCard event={makeEvent({ userRsvpStatus: "going" })} />);

    fireEvent.click(bell());

    expect(screen.getByText(/Get notified before event/i)).toBeInTheDocument();
  });

  it("says something when nobody has answered yet, rather than nothing at all", () => {
    render(<EventCard event={makeEvent()} />);

    fireEvent.click(bell());

    // The old dead click: a flag flipped, the picker's condition refused, and
    // the screen did not change in any way.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("arms the reminder the picker was opened for", () => {
    render(<EventCard event={makeEvent({ userRsvpStatus: "going" })} />);

    fireEvent.click(bell());
    fireEvent.click(screen.getByRole("button", { name: "30 min" }));

    expect(rsvpMutate).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 1, reminderMinutesBefore: 30 }),
      expect.anything(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Reminder set/i);
  });
});
