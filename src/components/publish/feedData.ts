/**
 * The vocabulary the publish panes share, kept away from React.
 *
 * This file used to hold the rules about *which* events were on screen —
 * `selectFeed`, `matchesView`, `matchesQuery`, `splitByTime` — because the feed
 * shipped every row to the browser and filtered them there. The server does all
 * of that now (`event.getFeed` takes the source, view, region, topic and
 * search), so what is left here is the vocabulary both sides have to agree on
 * and the presentation-only decisions the server has no business making: which
 * band a date falls in, how many places are left, how to spell a region.
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

export function isRegion(value: string | null | undefined): boolean {
  return !!value && REGIONS.some((region) => region.value === value && region.value !== "");
}

/**
 * What kind of event this is.
 *
 * One nullable enum on the row rather than a tags table — an event belongs to
 * one kind often enough that a join table would be ceremony. The labels are
 * translated at the call site; these are the stored values.
 */
export const TOPICS = [
  "tech",
  "music",
  "food",
  "sport",
  "art",
  "business",
  "education",
  "community",
] as const;

export type EventTopic = (typeof TOPICS)[number];

export function isTopic(value: string | null | undefined): value is EventTopic {
  return !!value && (TOPICS as readonly string[]).includes(value);
}

/**
 * The washes an event can wear where a photograph would go.
 *
 * Six, not sixty: a palette a host can hold in their head, and one that cannot
 * produce a feed of clashing rectangles. Each is two brand tokens blended, so
 * they follow the theme rather than fighting it.
 */
export const COVER_THEMES = [
  "dusk",
  "ember",
  "meadow",
  "blush",
  "sand",
  "tide",
] as const;

export type CoverTheme = (typeof COVER_THEMES)[number];

export function isCoverTheme(
  value: string | null | undefined,
): value is CoverTheme {
  return !!value && (COVER_THEMES as readonly string[]).includes(value);
}

/**
 * Which wash an event wears.
 *
 * A stored choice wins. Otherwise it is derived from the id — stable, so an
 * event does not change colour between two page loads, and spread, so a feed of
 * events nobody themed still reads as a feed rather than as a stack of grey.
 */
export function coverThemeFor(event: {
  id: number;
  coverTheme?: CoverTheme | null;
}): CoverTheme {
  if (event.coverTheme) return event.coverTheme;
  return COVER_THEMES[Math.abs(event.id) % COVER_THEMES.length]!;
}

/** The class pair that paints a cover. */
export function coverClass(event: {
  id: number;
  coverTheme?: CoverTheme | null;
}): string {
  return `kairos-cover kairos-cover-${coverThemeFor(event)}`;
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

/** A comment with the first few of its replies. */
export interface FeedCommentThread extends FeedComment {
  replyCount: number;
  replies: FeedComment[];
}

/**
 * Why a row is in front of you.
 *
 * The old feed could not answer this, because it had one ordering for everyone
 * and no idea who anybody followed. `null` means the only reason is time.
 */
export type FeedReason =
  | { kind: "hosting" }
  | { kind: "followedHost"; name: string | null }
  | { kind: "followedGoing"; count: number; name: string | null };

/** One of the faces on the attendance line. */
export interface FeedFace {
  id: string;
  name: string | null;
  image: string | null;
}

export interface FeedEvent {
  id: number;
  title: string;
  description: string;
  eventDate: Date;
  endsAt: Date | null;
  region: string;
  venue: string | null;
  address: string | null;
  capacity: number | null;
  topic: EventTopic | null;
  coverTheme: CoverTheme | null;
  imageUrl: string | null;
  createdAt: Date;
  /** When the host last changed something material. Null means never. */
  updatedAt: Date | null;
  createdById: string;
  enableRsvp: boolean;
  commentCount: number;
  likeCount: number;
  hasLiked: boolean;
  hasSaved: boolean;
  userRsvpStatus: "going" | "maybe" | "not_going" | null;
  viewerFollowsAuthor: boolean;
  /** Owner or co-host — both may edit, only the owner may delete. */
  viewerCanEdit: boolean;
  author: FeedAuthor;
  rsvpCounts: { going: number; maybe: number; notGoing: number };
  attendees: FeedFace[];
  reason: FeedReason | null;
}

/** An event as the card sees it — the row plus who is looking at it. */
export type FeedEventForViewer = FeedEvent & { isOwner: boolean };

/**
 * The ways into the feed, in rail order.
 *
 * `past` is last because it is the only one that reads backwards. It used to be
 * a band in the middle of the feed, which meant one list carried two orderings
 * and could not be paged without the seam landing somewhere absurd.
 */
export const FEED_VIEWS = [
  "all",
  "going",
  "maybe",
  "hosting",
  "saved",
  "past",
] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

export function isFeedView(value: string | null | undefined): value is FeedView {
  return !!value && (FEED_VIEWS as readonly string[]).includes(value);
}

/** Whose events: the people you chose, or everyone. */
export const FEED_SOURCES = ["following", "discover"] as const;
export type FeedSource = (typeof FEED_SOURCES)[number];

export function isFeedSource(
  value: string | null | undefined,
): value is FeedSource {
  return !!value && (FEED_SOURCES as readonly string[]).includes(value);
}

/** When an event is over — the start time, unless it says otherwise. */
export function eventEndsAt(event: {
  eventDate: Date | string;
  endsAt?: Date | string | null;
}): Date {
  const end = event.endsAt ?? event.eventDate;
  return end instanceof Date ? end : new Date(end);
}

export function isPast(
  event: { eventDate: Date | string; endsAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  return eventEndsAt(event).getTime() < now.getTime();
}

/**
 * Whether a reminder can still be armed for this event.
 *
 * A reminder is a promise to say something *before* an event, and the sweep in
 * `~/server/notifications/eventReminders` will not send one for an event that
 * is already over. Arming one on a past event therefore recorded a request that
 * could never be kept: the row was written, the card said "reminder set", and
 * nothing was ever delivered. Both the card and the event page ask this before
 * offering the choice, and `event.updateRsvp` enforces the same rule so a stale
 * page cannot make the promise either.
 */
export function canRemind(
  event: { eventDate: Date | string; endsAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  return !isPast(event, now);
}

/**
 * How many places are left, or `null` when the event has no ceiling.
 *
 * Only `going` counts against capacity: a *maybe* has not taken a seat, and
 * counting it would let a half-interested crowd close a door on people who
 * actually intend to turn up.
 */
export function placesLeft(event: {
  capacity: number | null;
  rsvpCounts: { going: number };
}): number | null {
  if (event.capacity === null) return null;
  return Math.max(0, event.capacity - event.rsvpCounts.going);
}

/**
 * The bands the feed reads in.
 *
 * Time, in the reader's terms rather than the calendar's: what is imminent,
 * what is next, and everything after. A band is a presentation decision — the
 * server returns one ordered list and the view draws a rule where the answer to
 * "when" changes.
 */
export const FEED_BANDS = ["thisWeek", "nextWeek", "later", "past"] as const;
export type FeedBand = (typeof FEED_BANDS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function bandFor(
  event: { eventDate: Date | string; endsAt?: Date | string | null },
  now: Date = new Date(),
): FeedBand {
  if (isPast(event, now)) return "past";

  const start =
    event.eventDate instanceof Date ? event.eventDate : new Date(event.eventDate);
  const days = (start.getTime() - now.getTime()) / DAY_MS;

  if (days < 7) return "thisWeek";
  if (days < 14) return "nextWeek";
  return "later";
}

/** One row of the feed: the event, and the band it reads under. */
export interface FeedRow {
  event: FeedEvent;
  band: FeedBand;
}

/**
 * Tag each row with its band, in the order the server returned them.
 *
 * Deliberately not a sort. The server has already ordered the page — forwards
 * through time, or backwards for `past` — and re-sorting here would fight the
 * cursor and make the page boundaries lie.
 */
export function bandRows(events: FeedEvent[], now: Date = new Date()): FeedRow[] {
  return events.map((event) => ({ event, band: bandFor(event, now) }));
}

/**
 * How soon, in the coarsest unit that is still true.
 *
 * The chip on the cover is the card's most-read three words, so it says "in 2
 * days" rather than "in 51 hours": nobody plans in hours until the day is
 * today. `null` once an event is more than a fortnight out or already over —
 * at that distance the date block says everything the chip would.
 */
export type Countdown =
  | { kind: "now" }
  | { kind: "soon"; count: number }
  | { kind: "hours"; count: number }
  | { kind: "days"; count: number };

export function countdownFor(
  event: { eventDate: Date | string; endsAt?: Date | string | null },
  now: Date = new Date(),
): Countdown | null {
  if (isPast(event, now)) return null;

  const start =
    event.eventDate instanceof Date ? event.eventDate : new Date(event.eventDate);
  const ms = start.getTime() - now.getTime();

  /* Started but not finished: a multi-day event on its second morning. */
  if (ms <= 0) return { kind: "now" };

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return { kind: "soon", count: Math.max(1, minutes) };

  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return { kind: "hours", count: hours };

  const days = Math.ceil(ms / DAY_MS);
  if (days <= 14) return { kind: "days", count: days };

  return null;
}

/**
 * The date block on a card — month, day, time as three separate strings so the
 * card can stack them.
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

/**
 * "19:00 – 22:00", or just "19:00" when nobody said when it ends.
 *
 * An end time on a different day is spelled out with its date, because
 * "19:00 – 02:00" reads as a typo rather than as a night that runs long.
 */
export function formatTimeRange(
  event: { eventDate: Date | string; endsAt?: Date | string | null },
  locale: string,
): string {
  const start =
    event.eventDate instanceof Date ? event.eventDate : new Date(event.eventDate);
  const time = (value: Date) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value);

  if (!event.endsAt) return time(start);

  const end = event.endsAt instanceof Date ? event.endsAt : new Date(event.endsAt);
  if (Number.isNaN(end.getTime())) return time(start);

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) return `${time(start)} – ${time(end)}`;

  const withDate = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${time(start)} – ${withDate.format(end)}`;
}

/**
 * Where it is, in one line: the building if we know it, the town otherwise.
 *
 * `region` is the only location an event is required to have, so this degrades
 * to the town rather than rendering an empty chip.
 */
export function placeLine(event: {
  venue: string | null;
  address: string | null;
  region: string;
}): string {
  const parts = [event.venue, event.address].filter(Boolean);
  if (parts.length === 0) return regionLabel(event.region);
  return parts.join(", ");
}
