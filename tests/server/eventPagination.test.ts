import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The feed query, read statically.
 *
 * These are source-based like the other server tests in this repo. What they
 * pin has changed shape: `getPublicEvents` ordered by creation, newest first,
 * for every visitor, and shipped every comment of every event on the page.
 * `getFeed` orders forward through time, filters on the server, and leaves
 * comments to the event page.
 */

const source = fs.readFileSync(
  path.resolve(__dirname, "../../src/server/api/routers/event.ts"),
  "utf-8",
);

describe("Event Router – the feed", () => {
  it("is a cursor-paginated procedure keyed on the event date", () => {
    expect(source).toContain("getFeed: publicProcedure");
    expect(source).toContain("cursor: z");
    expect(source).toContain("eventDate: z.date()");
    expect(source).toMatch(/\.limit\(limit \+ 1\)/);
  });

  it("pages forward through time, and only reverses for the past view", () => {
    expect(source).toContain("isPast ? desc(events.eventDate) : asc(events.eventDate)");
    expect(source).toContain("isPast ? desc(events.id) : asc(events.id)");
  });

  it("carries both halves of the cursor, so two events at the same minute page stably", () => {
    // Timestamps are bound through `ts()`: a raw Date inside a `sql` template
    // never reaches drizzle's column mapper and postgres-js cannot type it.
    expect(source).toContain(
      "${events.eventDate} > ${ts(eventDate)} OR (${events.eventDate} = ${ts(eventDate)} AND ${events.id} > ${id})",
    );
  });

  it("returns { items, nextCursor }", () => {
    expect(source).toContain("return { items, nextCursor }");
  });

  it("binds timestamps as timestamps rather than handing over a Date", () => {
    expect(source).toContain("::timestamptz");
    expect(source).toContain("function ts(value: Date)");
  });

  it("decides upcoming against the end time, not the start", () => {
    // Otherwise a three-day conference is "past" on its opening morning.
    expect(source).toContain("COALESCE(${events.endsAt}, ${events.eventDate})");
  });
});

describe("Event Router – selection happens on the server", () => {
  it("reads the follow graph for the Following lane", () => {
    expect(source).toContain("source === \"following\"");
    expect(source).toContain("followingIds(viewerId)");
  });

  it("surfaces events your follows are attending, not just the ones they host", () => {
    // The half that makes the lane worth reading: it finds events from people
    // you have never heard of, because people you trust are going.
    expect(source).toMatch(
      /EXISTS\(SELECT 1 FROM \$\{eventRsvps\}[\s\S]{0,200}IN \$\{followingIds\(viewerId\)\}/,
    );
  });

  it("puts your own events in your own Following lane", () => {
    // The first feed a host checks is the one their own event is supposed to
    // be in. Without this a host who follows nobody sees an empty screen and
    // concludes the publish button did nothing.
    expect(source).toContain("${events.createdById} = ${viewerId}");
  });

  it("falls back to Discover rather than showing an empty Following lane", () => {
    // Following nobody yet is the normal first state of the feature.
    expect(source).toContain('asked === "following" && pageRows.length === 0');
    expect(source).toContain('readPage("discover")');
    expect(source).toContain("usedSource");
  });

  it("only falls back on the first page", () => {
    // Paging forward past the end of a lane you chose should end, not switch
    // lanes under you.
    expect(source).toContain("!input?.cursor");
  });

  it("filters the personal views in SQL rather than in the browser", () => {
    expect(source).toContain('view === "going" || view === "maybe"');
    expect(source).toContain('view === "hosting"');
    expect(source).toContain('view === "saved"');
  });

  it("gives a signed-out visitor nothing for a view that is about them", () => {
    // "Events I am going to" with no viewer is not the whole feed; it is empty.
    expect(source).toContain("sql`false`");
  });

  it("searches title, description, venue and host name", () => {
    expect(source).toContain("${events.title} ILIKE ${pattern}");
    expect(source).toContain("${users.name} ILIKE ${pattern}");
  });

  it("computes the reason a row is in front of you", () => {
    expect(source).toContain("followedGoingCount");
    expect(source).toContain('kind: "followedHost"');
    expect(source).toContain('kind: "followedGoing"');
  });

  it("bounds the best-effort name lookup so it cannot grow with the follow graph", () => {
    expect(source).toContain("eventIds.length * 4");
  });
});

describe("Event Router – comments left the feed", () => {
  it("no longer fetches comments for the paged event ids", () => {
    // This was the single heaviest thing about the surface: every comment of
    // every event on the page, unbounded, in exchange for a two-line preview.
    expect(source).not.toContain("inArray(eventComments.eventId, eventIds)");
  });

  it("still reports how many there are", () => {
    expect(source).toContain("commentCount");
  });

  it("pages a single event's thread instead", () => {
    expect(source).toContain("loadCommentPage");
    expect(source).toContain("getComments: publicProcedure");
  });

  it("fetches replies for a whole page of parents at once, never per comment", () => {
    expect(source).toContain("inArray(eventComments.parentId, parentIds)");
  });
});

describe("Event Router – the event has an address", () => {
  it("serves one event to signed-out visitors", () => {
    expect(source).toContain("getById: publicProcedure");
  });

  it("emits on creation, which used to be the one silent moment", () => {
    expect(source).toContain("emitEventCreated(");
  });

  it("stamps an edit only when something actually changed", () => {
    // A save that changed nothing, and a co-host list edit, are not things the
    // forty people who already said yes need to be told about.
    expect(source).toContain("updateFields.updatedAt = new Date();");
    const guard = source.indexOf("if (Object.keys(updateFields).length === 0)");
    expect(source.indexOf("updateFields.updatedAt")).toBeGreaterThan(guard);
  });

  it("tells the feed whether the viewer may edit the row", () => {
    expect(source).toContain("viewerCanEdit");
  });

  it("lets co-hosts edit but not delete", () => {
    expect(source).toContain("event.isCoHost");
    expect(source).toContain("Only the host can change who is co-hosting.");
  });
});
