import { describe, it, expect } from "vitest";

import {
  eventDateParts,
  isFeedView,
  regionCounts,
  regionLabel,
  selectFeed,
  splitByTime,
  summariseEngagement,
  type FeedEvent,
} from "~/components/publish/feedData";

/** Thursday 20 August 2026, 09:00 local. */
const NOW = new Date(2026, 7, 20, 9, 0, 0);
const at = (day: number, hour = 19) => new Date(2026, 7, day, hour, 0, 0);

const ME = "user-me";

function event(overrides: Partial<FeedEvent> & { id: number }): FeedEvent {
  return {
    title: "Component Systems Night",
    description: "Three short talks, then open floor.",
    eventDate: at(25),
    region: "sofia",
    imageUrl: null,
    createdAt: at(18),
    createdById: "user-other",
    enableRsvp: true,
    commentCount: 0,
    likeCount: 0,
    hasLiked: false,
    userRsvpStatus: null,
    author: { id: "user-other", name: "Мира Kaneva", image: null },
    comments: [],
    rsvpCounts: { going: 0, maybe: 0, notGoing: 0 },
    ...overrides,
  };
}

const select = (over: Partial<Parameters<typeof selectFeed>[0]> & { events: FeedEvent[] }) =>
  selectFeed({
    view: "all",
    region: "",
    query: "",
    viewerId: ME,
    now: NOW,
    ...over,
  });

describe("regionLabel", () => {
  it("names a known region", () => {
    expect(regionLabel("stara_zagora")).toBe("Stara Zagora");
  });

  it("falls back to the raw value for an unknown one", () => {
    expect(regionLabel("atlantis")).toBe("atlantis");
  });
});

describe("isFeedView", () => {
  it("accepts the views the rail offers", () => {
    expect(isFeedView("hosting")).toBe(true);
  });

  it("rejects anything else, so a hand-edited URL cannot break the feed", () => {
    expect(isFeedView("saved")).toBe(false);
    expect(isFeedView(null)).toBe(false);
  });
});

describe("selectFeed", () => {
  const events = [
    event({ id: 1, region: "sofia", createdById: ME }),
    event({ id: 2, region: "varna", userRsvpStatus: "going" }),
    event({ id: 3, region: "sofia", userRsvpStatus: "maybe", eventDate: at(2) }),
  ];

  it("passes everything through on the default view", () => {
    expect(select({ events }).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("narrows to one region", () => {
    expect(select({ events, region: "varna" }).map((e) => e.id)).toEqual([2]);
  });

  it("'hosting' means events you created, not events you answered", () => {
    expect(select({ events, view: "hosting" }).map((e) => e.id)).toEqual([1]);
  });

  it("separates a 'going' answer from a 'maybe' one", () => {
    expect(select({ events, view: "going" }).map((e) => e.id)).toEqual([2]);
    expect(select({ events, view: "maybe" }).map((e) => e.id)).toEqual([3]);
  });

  it("'past' is decided against the clock it was given", () => {
    expect(select({ events, view: "past" }).map((e) => e.id)).toEqual([3]);
  });

  it("'hosting' finds nothing for a signed-out viewer", () => {
    expect(select({ events, view: "hosting", viewerId: null })).toEqual([]);
  });

  it("matches a query against the title, the region and the author", () => {
    expect(select({ events, query: "varna" }).map((e) => e.id)).toEqual([2]);
    expect(select({ events, query: "мира" }).map((e) => e.id)).toEqual([1, 2, 3]);
    expect(select({ events, query: "systems" }).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("combines the filters rather than picking one", () => {
    expect(
      select({ events, view: "maybe", region: "varna" }),
    ).toEqual([]);
  });
});

describe("splitByTime", () => {
  it("puts what is ahead soonest-first and what is over most-recent-first", () => {
    const bands = splitByTime(
      [
        event({ id: 1, eventDate: at(28) }),
        event({ id: 2, eventDate: at(10) }),
        event({ id: 3, eventDate: at(22) }),
        event({ id: 4, eventDate: at(15) }),
      ],
      NOW,
    );

    expect(bands.upcoming.map((e) => e.id)).toEqual([3, 1]);
    expect(bands.past.map((e) => e.id)).toEqual([4, 2]);
  });

  it("does not mutate the array it was handed", () => {
    const events = [event({ id: 1, eventDate: at(28) }), event({ id: 2, eventDate: at(21) })];
    splitByTime(events, NOW);
    expect(events.map((e) => e.id)).toEqual([1, 2]);
  });
});

describe("regionCounts", () => {
  it("counts every loaded event, not just the ones in view", () => {
    expect(
      regionCounts([
        event({ id: 1, region: "sofia" }),
        event({ id: 2, region: "sofia" }),
        event({ id: 3, region: "varna" }),
      ]),
    ).toEqual({ sofia: 2, varna: 1 });
  });
});

describe("summariseEngagement", () => {
  it("is null for an empty feed rather than a row of zeroes", () => {
    expect(summariseEngagement([])).toBeNull();
  });

  it("totals likes, comments and the two RSVPs that count as interest", () => {
    const summary = summariseEngagement([
      event({
        id: 1,
        likeCount: 4,
        commentCount: 2,
        rsvpCounts: { going: 5, maybe: 3, notGoing: 9 },
      }),
      event({ id: 2, likeCount: 1, commentCount: 0 }),
    ]);

    expect(summary).toMatchObject({
      totalLikes: 5,
      totalComments: 2,
      totalRsvps: 8,
      totalEvents: 2,
      peak: 6,
    });
  });

  it("ranks the top three by likes plus comments", () => {
    const summary = summariseEngagement([
      event({ id: 1, likeCount: 1 }),
      event({ id: 2, likeCount: 9 }),
      event({ id: 3, commentCount: 5 }),
      event({ id: 4 }),
    ]);

    expect(summary?.topEvents.map((e) => e.id)).toEqual([2, 3, 1]);
  });

  it("floors the peak at 1 so a feed with no engagement cannot divide by zero", () => {
    expect(summariseEngagement([event({ id: 1 })])?.peak).toBe(1);
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
