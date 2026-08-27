import { describe, it, expect } from "vitest";

import {
  FEED_SOURCES,
  FEED_VIEWS,
  TOPICS,
  bandFor,
  bandRows,
  eventDateParts,
  eventEndsAt,
  formatTimeRange,
  isFeedSource,
  isFeedView,
  isPast,
  isRegion,
  COVER_THEMES,
  coverClass,
  coverThemeFor,
  isCoverTheme,
  isTopic,
  placeLine,
  placesLeft,
  regionLabel,
  type FeedEvent,
} from "~/components/publish/feedData";

/**
 * What is left in `feedData` after the server took over selection.
 *
 * `selectFeed`, `matchesView`, `matchesQuery` and `splitByTime` used to live
 * here because the feed shipped every row to the browser and filtered them
 * there. `event.getFeed` does all of that now, so these tests cover what the
 * client still decides: which band a date falls in, how many places are left,
 * how a time range and a place read, and which URL values are legal.
 */

/** Thursday 20 August 2026, 09:00 local. */
const NOW = new Date(2026, 7, 20, 9, 0, 0);
const at = (day: number, hour = 19) => new Date(2026, 7, day, hour, 0, 0);

function event(overrides: Partial<FeedEvent> & { id: number }): FeedEvent {
  return {
    title: "Component Systems Night",
    description: "Three short talks, then open floor.",
    eventDate: at(25),
    endsAt: null,
    region: "sofia",
    venue: null,
    address: null,
    capacity: null,
    topic: null,
    coverTheme: null,
    imageUrl: null,
    createdAt: at(18),
    updatedAt: null,
    createdById: "user-other",
    enableRsvp: true,
    commentCount: 0,
    likeCount: 0,
    hasLiked: false,
    hasSaved: false,
    userRsvpStatus: null,
    viewerFollowsAuthor: false,
    viewerCanEdit: false,
    author: { id: "user-other", name: "Мира Kaneva", image: null },
    rsvpCounts: { going: 0, maybe: 0, notGoing: 0 },
    attendees: [],
    reason: null,
    ...overrides,
  };
}

describe("the values a URL may carry", () => {
  it("accepts every view the rail offers", () => {
    for (const view of FEED_VIEWS) expect(isFeedView(view)).toBe(true);
  });

  it("accepts both lanes", () => {
    for (const source of FEED_SOURCES) expect(isFeedSource(source)).toBe(true);
  });

  it("rejects anything else, so a hand-edited URL cannot break the feed", () => {
    for (const value of ["", null, undefined, "saved-drafts", "FOLLOWING"]) {
      expect(isFeedView(value as string | null)).toBe(false);
    }
    expect(isFeedSource("everyone")).toBe(false);
    expect(isTopic("politics")).toBe(false);
    expect(isRegion("atlantis")).toBe(false);
  });

  it("does not treat the empty region as a real one", () => {
    // `""` means "every region" in the URL, and passing it to the server as a
    // filter would silently return nothing.
    expect(isRegion("")).toBe(false);
    expect(isRegion("varna")).toBe(true);
  });

  it("knows every topic the schema stores", () => {
    for (const topic of TOPICS) expect(isTopic(topic)).toBe(true);
  });
});

describe("when an event is over", () => {
  it("reads the start time when nobody said when it ends", () => {
    expect(eventEndsAt(event({ id: 1, eventDate: at(25) }))).toEqual(at(25));
  });

  it("keeps a multi-day event upcoming until its last day", () => {
    // The whole reason `ends_at` exists: a three-day conference used to file
    // itself under "already happened" on its opening morning.
    const conference = event({
      id: 1,
      eventDate: at(19, 9),
      endsAt: at(22, 18),
    });

    expect(isPast(conference, NOW)).toBe(false);
    expect(bandFor(conference, NOW)).toBe("thisWeek");
  });

  it("is past once the end has gone by", () => {
    expect(isPast(event({ id: 1, eventDate: at(18), endsAt: at(18, 23) }), NOW)).toBe(
      true,
    );
  });
});

describe("bands", () => {
  it("splits the future into this week, next week and later", () => {
    expect(bandFor(event({ id: 1, eventDate: at(22) }), NOW)).toBe("thisWeek");
    expect(bandFor(event({ id: 2, eventDate: at(29) }), NOW)).toBe("nextWeek");
    expect(bandFor(event({ id: 3, eventDate: at(40) }), NOW)).toBe("later");
  });

  it("files anything already over under past", () => {
    expect(bandFor(event({ id: 1, eventDate: at(12) }), NOW)).toBe("past");
  });

  it("tags rows without reordering them", () => {
    // The server has already ordered the page, and re-sorting here would fight
    // the cursor and make the page boundaries lie.
    const rows = bandRows(
      [
        event({ id: 3, eventDate: at(40) }),
        event({ id: 1, eventDate: at(22) }),
        event({ id: 2, eventDate: at(29) }),
      ],
      NOW,
    );

    expect(rows.map((row) => row.event.id)).toEqual([3, 1, 2]);
    expect(rows.map((row) => row.band)).toEqual([
      "later",
      "thisWeek",
      "nextWeek",
    ]);
  });
});

describe("placesLeft", () => {
  it("is null when the event has no ceiling", () => {
    expect(placesLeft(event({ id: 1, capacity: null }))).toBeNull();
  });

  it("counts only the people who said they are going", () => {
    // A maybe has not taken a seat. Counting it would let a half-interested
    // crowd close the door on people who actually intend to turn up.
    const nearlyFull = event({
      id: 1,
      capacity: 40,
      rsvpCounts: { going: 32, maybe: 12, notGoing: 3 },
    });

    expect(placesLeft(nearlyFull)).toBe(8);
  });

  it("floors at zero rather than going negative", () => {
    const oversubscribed = event({
      id: 1,
      capacity: 10,
      rsvpCounts: { going: 14, maybe: 0, notGoing: 0 },
    });

    expect(placesLeft(oversubscribed)).toBe(0);
  });
});

describe("cover themes", () => {
  it("uses the wash the host chose", () => {
    expect(coverThemeFor({ id: 3, coverTheme: "ember" })).toBe("ember");
  });

  it("derives one from the id when nobody chose", () => {
    // Null does not mean "no colour" — it means "we pick". Every event written
    // before the column existed still comes out coloured.
    expect(coverThemeFor({ id: 3, coverTheme: null })).toBe(COVER_THEMES[3]);
    expect(coverThemeFor({ id: 12 })).toBe(COVER_THEMES[0]);
  });

  it("is stable, so an event does not change colour between page loads", () => {
    expect(coverThemeFor({ id: 41 })).toBe(coverThemeFor({ id: 41 }));
  });

  it("spreads consecutive events across the whole palette", () => {
    // Otherwise a feed of events nobody themed is a column of one colour.
    const run = [1, 2, 3, 4, 5, 6].map((id) => coverThemeFor({ id }));
    expect(new Set(run).size).toBe(COVER_THEMES.length);
  });

  it("survives an id that should not exist", () => {
    expect(COVER_THEMES).toContain(coverThemeFor({ id: -7 }));
  });

  it("names both classes, so the wash and its palette arrive together", () => {
    expect(coverClass({ id: 0, coverTheme: "tide" })).toBe(
      "kairos-cover kairos-cover-tide",
    );
  });

  it("rejects a theme the stylesheet has no class for", () => {
    expect(isCoverTheme("neon")).toBe(false);
    for (const theme of COVER_THEMES) expect(isCoverTheme(theme)).toBe(true);
  });
});

describe("placeLine", () => {
  it("falls back to the town, which is the only location an event must have", () => {
    expect(placeLine(event({ id: 1, region: "varna" }))).toBe("Varna");
  });

  it("prefers the venue and address once they exist", () => {
    expect(
      placeLine(
        event({ id: 1, venue: "Betahaus", address: "ul. Krum Popov 56" }),
      ),
    ).toBe("Betahaus, ul. Krum Popov 56");
  });

  it("uses whichever half was filled in", () => {
    expect(placeLine(event({ id: 1, venue: "Betahaus" }))).toBe("Betahaus");
  });
});

describe("formatTimeRange", () => {
  it("is one time when nothing says when it ends", () => {
    expect(formatTimeRange(event({ id: 1, eventDate: at(25, 19) }), "en-GB")).toBe(
      "19:00",
    );
  });

  it("is a range within one day", () => {
    expect(
      formatTimeRange(
        event({ id: 1, eventDate: at(25, 19), endsAt: at(25, 22) }),
        "en-GB",
      ),
    ).toBe("19:00 – 22:00");
  });

  it("spells out the date when the end is on another day", () => {
    // "19:00 – 02:00" reads as a typo rather than as a night that runs long.
    const range = formatTimeRange(
      event({ id: 1, eventDate: at(25, 19), endsAt: at(26, 2) }),
      "en-GB",
    );

    expect(range).toContain("19:00");
    expect(range).toMatch(/26/);
  });
});

describe("regionLabel", () => {
  it("spells the stored value", () => {
    expect(regionLabel("stara_zagora")).toBe("Stara Zagora");
  });

  it("returns the value itself for something it does not know", () => {
    expect(regionLabel("atlantis")).toBe("atlantis");
  });
});

describe("eventDateParts", () => {
  it("splits a date into the three strings the card stacks", () => {
    const parts = eventDateParts(new Date(2026, 8, 4, 19, 0, 0), "en-US");
    expect(parts.day).toBe("04");
    expect(parts.time).toBe("19:00");
    expect(parts.month.toLowerCase()).toContain("sep");
  });

  it("returns empty strings for an unparseable date instead of 'Invalid Date'", () => {
    expect(eventDateParts("not a date", "en-US")).toEqual({
      month: "",
      day: "",
      time: "",
    });
  });
});
