/**
 * The rules about *which* events are on screen, kept away from React.
 *
 * The old feed made these decisions inline in the middle of JSX — a `.filter()`
 * on region buried between two sidebars — so there was nowhere to look up what
 * "the feed" actually meant. Everything here is a pure function over the rows
 * the router returned, which also makes the interesting cases testable without
 * mounting a tRPC provider.
 */

export const REGIONS = [
  { value: "", label: "All Regions" },
  { value: "sofia", label: "Sofia" },
  { value: "plovdiv", label: "Plovdiv" },
  { value: "varna", label: "Varna" },
  { value: "burgas", label: "Burgas" },
  { value: "ruse", label: "Ruse" },
  { value: "stara_zagora", label: "Stara Zagora" },
  { value: "pleven", label: "Pleven" },
  { value: "sliven", label: "Sliven" },
  { value: "dobrich", label: "Dobrich" },
  { value: "shumen", label: "Shumen" },
] as const;

export function regionLabel(value: string): string {
  return REGIONS.find((region) => region.value === value)?.label ?? value;
}

export interface FeedAuthor {
  id: string | null;
  name: string | null;
  image: string | null;
}

export interface FeedComment {
  id: number;
  text: string;
  imageUrl: string | null;
  createdAt: Date;
  author: FeedAuthor;
}

export interface FeedEvent {
  id: number;
  title: string;
  description: string;
  eventDate: Date;
  region: string;
  imageUrl: string | null;
  createdAt: Date;
  createdById: string;
  enableRsvp: boolean;
  commentCount: number;
  likeCount: number;
  hasLiked: boolean;
  userRsvpStatus: "going" | "maybe" | "not_going" | null;
  author: FeedAuthor;
  comments: FeedComment[];
  rsvpCounts: { going: number; maybe: number; notGoing: number };
}

/** An event as the card sees it — the row plus who is looking at it. */
export type FeedEventForViewer = FeedEvent & { isOwner: boolean };

/**
 * The ways into the feed, in rail order.
 *
 * `saved` and `friends` from the proposal are deliberately absent: nothing in
 * the schema records either, and a rail entry that always reads 0 is worse than
 * no rail entry.
 */
export const FEED_VIEWS = ["all", "going", "maybe", "hosting", "past"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

export function isFeedView(value: string | null | undefined): value is FeedView {
  return !!value && (FEED_VIEWS as readonly string[]).includes(value);
}

function isPast(event: FeedEvent, now: Date): boolean {
  return new Date(event.eventDate).getTime() < now.getTime();
}

function matchesView(
  event: FeedEvent,
  view: FeedView,
  viewerId: string | null,
  now: Date,
): boolean {
  switch (view) {
    case "going":
      return event.userRsvpStatus === "going";
    case "maybe":
      return event.userRsvpStatus === "maybe";
    case "hosting":
      return !!viewerId && event.createdById === viewerId;
    case "past":
      return isPast(event, now);
    case "all":
    default:
      return true;
  }
}

function matchesQuery(event: FeedEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    event.title.toLowerCase().includes(needle) ||
    event.description.toLowerCase().includes(needle) ||
    regionLabel(event.region).toLowerCase().includes(needle) ||
    (event.author.name ?? "").toLowerCase().includes(needle)
  );
}

export interface SelectFeedInput {
  events: FeedEvent[];
  view: FeedView;
  /** `""` means every region. */
  region: string;
  query: string;
  viewerId: string | null;
  now?: Date;
}

export function selectFeed({
  events,
  view,
  region,
  query,
  viewerId,
  now = new Date(),
}: SelectFeedInput): FeedEvent[] {
  return events.filter(
    (event) =>
      (region === "" || event.region === region) &&
      matchesView(event, view, viewerId, now) &&
      matchesQuery(event, query),
  );
}

/**
 * The two bands the feed reads in.
 *
 * The proposal splits "from your connections" from "public beyond them", which
 * needs a social graph this app does not have yet. The honest split with the
 * same rhythm is time: what is still ahead of you, soonest first, then what has
 * already happened, most recent first.
 */
export interface FeedBands {
  upcoming: FeedEvent[];
  past: FeedEvent[];
}

export function splitByTime(events: FeedEvent[], now = new Date()): FeedBands {
  const upcoming: FeedEvent[] = [];
  const past: FeedEvent[] = [];

  for (const event of events) {
    (isPast(event, now) ? past : upcoming).push(event);
  }

  upcoming.sort(
    (a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
  );
  past.sort(
    (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime(),
  );

  return { upcoming, past };
}

/**
 * Region counts for the picker, over everything loaded rather than the current
 * view — the point of the picker is to show you where else there is something.
 */
export function regionCounts(events: FeedEvent[]): Record<string, number> {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.region] = (counts[event.region] ?? 0) + 1;
    return counts;
  }, {});
}

export interface EngagementSummary {
  totalLikes: number;
  totalComments: number;
  totalRsvps: number;
  totalEvents: number;
  /** The busiest event's like+comment total, floored at 1 so bars can divide. */
  peak: number;
  topEvents: FeedEvent[];
}

export function summariseEngagement(events: FeedEvent[]): EngagementSummary | null {
  if (events.length === 0) return null;

  const score = (event: FeedEvent) => event.likeCount + event.commentCount;

  return {
    totalLikes: events.reduce((sum, event) => sum + event.likeCount, 0),
    totalComments: events.reduce((sum, event) => sum + event.commentCount, 0),
    totalRsvps: events.reduce(
      (sum, event) => sum + event.rsvpCounts.going + event.rsvpCounts.maybe,
      0,
    ),
    totalEvents: events.length,
    peak: Math.max(...events.map(score), 1),
    topEvents: [...events].sort((a, b) => score(b) - score(a)).slice(0, 3),
  };
}

/**
 * The date block on a card — month, day, time as three separate strings so the
 * card can stack them the way the proposal does.
 */
export function eventDateParts(
  date: Date | string,
  locale: string,
): { month: string; day: string; time: string } {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    return { month: "", day: "", time: "" };
  }

  return {
    month: new Intl.DateTimeFormat(locale, { month: "short" }).format(value),
    day: new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(value),
    time: new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value),
  };
}
