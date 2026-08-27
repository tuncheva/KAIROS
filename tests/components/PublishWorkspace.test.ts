import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The publish surface, read statically.
 *
 * These panes are wired to tRPC hooks all the way down, so rather than mounting
 * a provider tree these tests assert on the source: that the surface still owns
 * the behaviour the old feed had, that it uses design tokens rather than the
 * hardcoded palette from the proposal, and that no legacy card classes crept
 * back in. The interesting *logic* is in `feedData.ts` and tested for real in
 * `feedData.test.ts`.
 */

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../", relative), "utf-8");

const workspace = read("src/components/publish/PublishWorkspace.tsx");
const card = read("src/components/publish/EventCard.tsx");
const rail = read("src/components/publish/PublishRail.tsx");
const aside = read("src/components/publish/PublishAside.tsx");
const progress = read("src/components/publish/EventProgress.tsx");
const pager = read("src/components/publish/FeedPager.tsx");
const eventPage = read("src/components/events/EventPage.tsx");
const discussion = read("src/components/events/EventDiscussion.tsx");
const detailFields = read("src/components/events/EventDetailFields.tsx");
const eventRoute = read("src/app/events/[id]/page.tsx");
const proxy = read("src/proxy.ts");
const composer = read("src/components/publish/EventComposer.tsx");
const createForm = read("src/components/events/CreateEventForm.tsx");
const regionPicker = read("src/components/events/RegionMapPicker.tsx");

const panes = { workspace, card, rail, aside, composer, progress, pager, eventPage, discussion, detailFields };

describe("Publish panes – design tokens", () => {
  for (const [name, source] of Object.entries(panes)) {
    it(`${name} uses no legacy card classes`, () => {
      expect(source).not.toContain("ios-card");
      expect(source).not.toContain("ios-header");
    });

    it(`${name} takes its accent from the theme, not a hardcoded purple`, () => {
      // The proposal is drawn in #a855f7; the app's accent is user-selectable,
      // so every purple has to come through the token.
      expect(source.toLowerCase()).not.toContain("#a855f7");
      expect(source.toLowerCase()).not.toContain("#c084fc");
    });
  }

  it("the mono stamps reuse the classes the rest of the app already loads", () => {
    expect(read("src/components/publish/publishUi.tsx")).toContain("kairos-stamp");
    expect(card).toContain("kairos-mono");
    expect(rail).toContain("kairos-mono");
  });

  it("the feed entrance reuses the dashboard's rise, which honours reduced motion", () => {
    expect(card).toContain("dash-rise");
    expect(rail).toContain("dash-rise");
  });
});

describe("PublishWorkspace – what is on screen", () => {
  it("keeps the view and region in the URL so a filtered feed is shareable", () => {
    expect(workspace).toContain("useSearchParams");
    expect(workspace).toContain("router.replace");
  });

  /**
   * Selection moved to the server.
   *
   * The feed used to fetch every row and filter it in the browser, which made
   * the views lie: "Going" filtered whatever the cursor had handed over, so it
   * showed three events until you paged far enough forward. Source, view,
   * region, topic and search are `where` clauses now.
   */
  it("asks the server for the rows rather than filtering them here", () => {
    expect(workspace).toContain("api.event.getFeed.useInfiniteQuery");
    expect(workspace).not.toContain("selectFeed");
    expect(workspace).toContain("source,");
    expect(workspace).toContain("view,");
    expect(workspace).toContain("topic,");
  });

  it("offers both lanes and remembers which one you are in", () => {
    expect(workspace).toContain('params.get("source")');
    expect(workspace).toContain("sources.");
  });

  it("shows the lane you asked for, or nothing", () => {
    // The server no longer substitutes Discover for an empty Following lane,
    // so there is no banner apologising for it either — an empty Following
    // lane renders the empty state, which offers Discover as a button.
    expect(workspace).not.toContain("usedSource");
    expect(workspace).not.toContain("followingFellBack");
    expect(workspace).toContain("noEventsFollowing");
    expect(workspace).toContain('setFilter({ source: "discover" })');
  });

  it("lands you on Discover rather than on an empty Following lane", () => {
    // Nobody follows anybody on the day a follow graph ships.
    expect(workspace).toContain('isFeedSource(rawSource) ? rawSource : "discover"');
  });

  it("gives search the input it never had", () => {
    // `matchesQuery` was written, tested and unreachable: `selectFeed` took a
    // query and the workspace passed the empty string.
    expect(workspace).toContain('params.get("q")');
    expect(workspace).toContain("searchPlaceholder");
    expect(workspace).toContain("SEARCH_DEBOUNCE_MS");
  });

  it("takes the band from the row rather than re-sorting the page", () => {
    expect(workspace).toContain("bandRows");
  });

  /**
   * Pagination replaced infinite scroll.
   *
   * The old feed mounted every event ever loaded behind an IntersectionObserver,
   * so a long feed meant hundreds of live cards each replaying their entrance as
   * they crossed the viewport. The assertion is inverted: the observer must be
   * gone, the page must be in the URL, and only one page of cards may render.
   */
  it("pages the feed instead of growing it forever", () => {
    expect(workspace).not.toContain("IntersectionObserver");
    expect(workspace).toContain("PAGE_SIZE");
    expect(workspace).toContain('params.get("page")');
    expect(workspace).toContain("<FeedPager");
  });

  it("still pulls cursors underneath so a page can be filled", () => {
    expect(workspace).toContain("fetchNextPage");
    expect(workspace).toContain("hasNextPage");
  });

  it("treats one server page as one feed page", () => {
    expect(workspace).toContain("loadedPages.length");
    expect(workspace).toContain("FEED_PAGE_SIZE");
  });

  it("stays live, including on the creation that used to emit nothing", () => {
    expect(workspace).toContain('useSocketEvent("event:created"');
    expect(workspace).toContain('useSocketEvent("event:deleted"');
    expect(workspace).toContain('useSocketEvent("event:updated"');
  });

  it("takes the counts that depend on you from the server, not the loaded page", () => {
    expect(workspace).toContain("getMySummary");
  });

  it("sends an old /publish?event=ID link to the event page", () => {
    expect(workspace).toContain('params.get("event")');
    expect(workspace).toContain("router.replace(`/events/${deepLinkedId}`)");
  });

  /**
   * Reminders moved off the client.
   *
   * `EventReminderService` was a `"use client"` component running a five-minute
   * `setInterval` per viewer against a mutation that returned success without
   * sending anything. Reminders now come from the server scheduler tick, so the
   * assertion is inverted: this page must NOT be driving them.
   */
  it("does not poll for reminders from the browser", () => {
    expect(workspace).not.toContain("EventReminderService");
  });
});

describe("EventCard – everything the old card could do", () => {
  it("leads with the cover and the date block", () => {
    expect(card).toContain("object-cover");
    expect(card).toContain("eventDateParts");
  });

  it("offers all three RSVP answers as one segmented control", () => {
    expect(card).toContain('status: "going"');
    expect(card).toContain('status: "maybe"');
    expect(card).toContain('status: "not_going"');
    expect(card).toContain('role="group"');
  });

  it("likes and RSVPs paint optimistically", () => {
    expect(card).toContain("useOptimisticLike");
    expect(card).toContain("useOptimisticRsvp");
  });

  it("keeps the reminder picker and its timings", () => {
    expect(card).toContain("getNotified");
    expect(card).toContain("REMINDER_CHOICES");
  });

  /**
   * The bell used to be a dead click twice over: on a past event, and on any
   * event you had not answered yet. It toggled a flag, the picker's own
   * condition refused to render, and nothing happened at all.
   */
  it("answers the bell instead of toggling a picker that will not open", () => {
    expect(card).toContain("canRemind(event)");
    expect(card).toContain("reminderPastEvent");
    expect(card).toContain("reminderNeedsRsvp");
  });

  /**
   * Comments left the card.
   *
   * Every comment of every event on the page used to ship with the feed and
   * render two at a time behind a toggle — the heaviest thing about the
   * surface, in exchange for a preview nobody could read. The count stays, as
   * a link to the thread.
   */
  it("links to the thread rather than carrying it", () => {
    expect(card).not.toContain("viewAllComments");
    expect(card).not.toContain("addComment");
    expect(card).toContain("href={`/events/${event.id}#discussion`}");
    expect(card).toContain("event.commentCount");
  });

  it("says why the row is in front of you", () => {
    expect(card).toContain("reasonFollowedHost");
    expect(card).toContain("reasonFollowedGoing");
  });

  it("offers the follow where you meet the person", () => {
    // Sending somebody to a profile to press Follow loses the event.
    expect(card).toContain("api.profile.follow.useMutation");
    expect(card).toContain("viewerFollowsAuthor");
  });

  it("shows the facts a person needs before deciding", () => {
    expect(card).toContain("placeLine(event)");
    expect(card).toContain("formatTimeRange(event, locale)");
    expect(card).toContain("placesLeft");
  });

  it("lets a full event still take Maybe and Cannot go", () => {
    // It is the seat that ran out, not the question.
    expect(card).toContain('full && option.status === "going"');
  });

  it("can bookmark without pretending to attend", () => {
    expect(card).toContain("useOptimisticSave");
  });

  it("keeps share, message-the-host, edit, delete and the host's dashboard", () => {
    expect(card).toContain("clipboard.writeText");
    expect(card).toContain("getOrCreateDirectConversation");
    expect(card).toContain("EditEventForm");
    expect(card).toContain("useOptimisticDelete");
    expect(card).toContain("RsvpDashboard");
  });

  it("arms the delete before it fires", () => {
    expect(card).toContain("deleteArmed");
    expect(card).toContain("confirmDeleteEvent");
  });

  it("only renders covers from hosts next/image is configured for", () => {
    expect(card).toContain("ALLOWED_IMAGE_HOSTS");
    expect(card).toContain("utfs.io");
  });

  it("tells a signed-out visitor to sign in rather than failing silently", () => {
    expect(card).toContain("signInToLike");
    expect(card).toContain("signInToRsvp");
    expect(card).toContain("signInToSave");
    expect(card).toContain("signInToFollow");
  });
});

describe("EventCard – the proposal's card, not the old one", () => {
  it("puts how-soon, what-kind and which-town on the cover", () => {
    // Three chips on one line rather than three lines of chrome: they are what
    // a person reads before anything else on the card.
    expect(card).toContain("coverChips");
    expect(card).toContain("countdownFor(event)");
    expect(card).toContain("countdown.days");
  });

  it("keeps those chips when there is no cover image", () => {
    // Two thirds of events have no image, and the card must not lose its
    // reading order because of it.
    expect(card).toContain("isValidImageUrl(event.imageUrl) ? (");
    expect(card).toContain("chipBase");
  });

  it("says an event was edited, to everyone", () => {
    // Not a host-only detail: somebody who already said yes is exactly the
    // person who needs to know the plan moved under them.
    expect(card).toContain("event.updatedAt &&");
    expect(card).toContain('t("edited")');
  });

  it("offers the pencil to co-hosts, and the bin only to the owner", () => {
    expect(card).toContain("{event.viewerCanEdit && (");
    expect(card).toContain("{event.isOwner && (");
  });

  it("wears a colour when there is no photograph", () => {
    // Which is most events. A feed of grey rectangles is a feed nobody scans.
    expect(card).toContain("coverClass(event)");
  });

  it("lets a photograph win over the wash", () => {
    // The wash is the fallback, not a layer on top of the picture.
    expect(card).toContain("isValidImageUrl(event.imageUrl) ? (");
    const cover = card.slice(
      card.indexOf("{/* The cover carries the card"),
      card.indexOf("{/* When, then what, then where. */}"),
    );
    expect(cover.indexOf("<Image")).toBeLessThan(cover.indexOf("coverClass(event)"));
  });

  it("leads the attendance line with faces and names", () => {
    // A name you recognise decides this faster than any count.
    expect(card).toContain("event.attendees.map");
    expect(card).toContain("attendanceNamesAndMore");
    expect(card).toContain("ring-2 ring-bg-elevated");
  });

  it("gives the RSVP its own full-width row", () => {
    // It is the one thing the card is asking for, and it used to share a line
    // with five icon buttons.
    expect(card).toContain("h-9 flex-1 rounded-lg text-[12.5px] font-semibold");
  });

  it("draws the reactions flat, under a hairline", () => {
    expect(card).toContain("border-t border-slate-100 px-2.5 py-2");
    expect(card).not.toContain("flex h-9 items-center gap-2 rounded-lg border px-3");
  });

  it("sets the title in the display face", () => {
    expect(card).toContain("font-display");
  });

  it("carries the card on a shadow rather than a hard border", () => {
    expect(card).toContain("bg-bg-elevated shadow-");
  });
});

describe("PublishRail – the ways into the feed", () => {
  it("renders every view the data can actually support", () => {
    expect(rail).toContain("FEED_VIEWS");
  });

  it("keeps the filters reachable below lg instead of hiding them", () => {
    // The rail vanishing below `lg` used to take the only filter with it.
    expect(rail).toContain("lg:hidden");
    expect(rail).toContain("showMobileFilters");
  });

  it("counts the chips from the server, not from the loaded page", () => {
    // A paged feed counting its own rows is counting a screenful.
    expect(workspace).toContain("api.event.getFacets.useQuery");
    expect(rail).toContain("regionTotals");
    expect(rail).toContain("topicTotals");
  });

  it("says where you stand in the follow graph, not your own email", () => {
    // On a page whose premise is who you follow, that is the line that belongs
    // under your name.
    expect(rail).toContain("followLine");
    // Still the fallback for somebody with no display name — just not the line
    // under it any more.
    expect(rail).not.toContain("{session.user.email}");
  });

  it("gives every view an icon", () => {
    expect(rail).toContain("VIEW_ICONS");
  });

  it("shows every town rather than hiding them behind a dropdown", () => {
    // The question the picker exists to answer is where else there is
    // something on, which a `<select>` cannot show.
    expect(rail).not.toContain("onChange={(event) => onRegionChange");
    expect(rail).toContain("FilterChip");
  });
});

describe("PublishAside – real requests only", () => {
  it("fills the request slot with workspace invitations, which accept for real", () => {
    expect(aside).toContain("getMyInvites");
    expect(aside).toContain("acceptInvite");
    expect(aside).toContain("declineInvite");
  });

  it("shows the agenda from the server, not from whatever page happens to be loaded", () => {
    expect(aside).toContain("getMySummary");
  });

  /**
   * The right column lost its two navigation panels. Quick links and workspaces
   * repeated the side nav while spending width the feed needed, so what is left
   * is only the two things that are about you and live nowhere else here.
   */
  it("carries no navigation panels the side nav already has", () => {
    expect(aside).not.toContain("QuickLinks");
    expect(aside).not.toContain("yourWorkspaces");
  });

  it("introduces people, which is what makes the Following lane worth having", () => {
    expect(aside).toContain("getSuggestions");
    expect(aside).toContain("profile.follow.useMutation");
  });

  it("says why each suggestion is being made", () => {
    // A suggestion the system cannot justify is a stranger with a button on them.
    expect(aside).toContain("suggestHosted");
    expect(aside).toContain("suggestSharedEvents");
    expect(aside).toContain("suggestSharedOrgs");
  });
});

describe("EventProgress – the summary as a dialog", () => {
  it("opens from a button in the feed toolbar", () => {
    expect(workspace).toContain("<EventProgressButton");
    expect(progress).toContain("eventProgress");
  });

  it("is a real dialog: portalled, labelled, and closable on Escape", () => {
    expect(progress).toContain("createPortal");
    expect(progress).toContain('aria-modal="true"');
    expect(progress).toContain('"Escape"');
  });

  /**
   * The numbers are the host's, not the reader's.
   *
   * This used to sum whatever rows the feed cursor had loaded, which measured
   * how far somebody had scrolled rather than how an event had done.
   */
  it("reads per-event totals from the server", () => {
    expect(progress).toContain("api.event.getHostStats.useQuery");
    expect(progress).not.toContain("summariseEngagement");
  });

  it("does not offer itself to somebody who hosts nothing", () => {
    expect(progress).toContain('summary?.counts.hosting ?? 0) === 0');
  });
});

describe("The event page – a link you can send", () => {
  it("is a route of its own, outside the app shell", () => {
    expect(eventRoute).toContain("EventPage");
    expect(eventRoute).toContain("generateMetadata");
  });

  it("previews properly when pasted somewhere", () => {
    expect(eventRoute).toContain("openGraph");
    expect(eventRoute).toContain("twitter");
  });

  it("is let through the cookie gate, because that is the point of it", () => {
    expect(proxy).toContain('pathname.startsWith("/events/")');
  });

  it("renders for a signed-out visitor down to the sign-in prompt", () => {
    expect(eventPage).toContain("callbackUrl=/events/");
    expect(eventPage).toContain("signInToRsvp");
  });

  it("pins the decision on a phone instead of asking for a scroll back up", () => {
    expect(eventPage).toContain("fixed inset-x-0 bottom-0");
  });

  it("edits in place rather than sending you back to a filtered feed", () => {
    expect(eventPage).toContain("EditEventForm");
    expect(eventPage).toContain("setShowEditForm(true)");
    expect(eventPage).toContain("event.canEdit");
  });

  it("says a past event cannot remind you, rather than pretending it can", () => {
    expect(eventPage).toContain("canRemind(event)");
    expect(eventPage).toContain("reminderPastEvent");
    // The standing "reminder set — change it" line goes with it.
    expect(eventPage).toContain("!showReminders && !past");
  });

  it("shows the edited stamp on the page too", () => {
    expect(eventPage).toContain("editedOn");
  });

  it("carries the host, the co-hosts, the attendees and the place", () => {
    expect(eventPage).toContain("hostedBy");
    expect(eventPage).toContain("event.coHosts");
    expect(eventPage).toContain("getAttendees");
    expect(eventPage).toContain("openInMaps");
  });

  it("threads replies one level deep and no further", () => {
    expect(discussion).toContain("thread.replies");
    expect(discussion).toContain("parentId={thread.id}");
  });

  it("pages the thread rather than loading all of it", () => {
    expect(discussion).toContain("getComments.useQuery");
    expect(discussion).toContain("loadMoreComments");
  });
});

describe("EventDetailFields – what an event can finally say", () => {
  it("collects the columns the schema grew", () => {
    expect(detailFields).toContain("endsAt");
    expect(detailFields).toContain("venue");
    expect(detailFields).toContain("address");
    expect(detailFields).toContain("capacity");
    expect(detailFields).toContain("topic");
  });

  it("makes Tag Collaborators do something", () => {
    // It was a dashed plus with no handler, no state and no column.
    expect(detailFields).toContain("CoHostPicker");
    expect(detailFields).toContain("coHostIds");
  });

  it("offers the cover colours, and auto as a real choice", () => {
    expect(detailFields).toContain("COVER_THEMES.map");
    expect(detailFields).toContain("coverAuto");
    expect(detailFields).toContain("coverClass(");
  });

  it("treats a blank capacity as unlimited rather than zero", () => {
    expect(detailFields).toContain("capacity > 0");
  });

  it("is shared by both forms rather than written twice", () => {
    expect(createForm).toContain("EventDetailFields");
    expect(read("src/components/events/EditEventForm.tsx")).toContain(
      "EventDetailFields",
    );
  });
});

describe("FeedPager – an open-ended total", () => {
  it("marks that more pages are fetchable rather than inventing a total", () => {
    expect(pager).toContain("hasMore");
  });

  it("labels its controls and marks the current page for screen readers", () => {
    expect(pager).toContain('aria-label={t("previousPage")}');
    expect(pager).toContain('aria-label={t("nextPage")}');
    expect(pager).toContain('aria-current={entry === page ? "page" : undefined}');
  });
});

describe("EventComposer – the title survives the handoff", () => {
  it("hands the dialog a title and the field the chip named", () => {
    expect(composer).toContain("onOpen");
    expect(composer).toContain("focus");
    expect(workspace).toContain("initialTitle={draft.title}");
    expect(workspace).toContain("focusField={draft.focus}");
  });
});

describe("CreateEventForm – design tokens", () => {
  it("does not use legacy card classes", () => {
    expect(createForm).not.toContain("ios-card");
  });

  it("uses bg-transparent for input backgrounds", () => {
    expect(createForm).toContain("bg-transparent");
  });

  it("has a Publish Event submit button on the accent", () => {
    expect(createForm).toContain("publishEvent");
    expect(createForm).toContain("bg-accent-primary");
  });

  it("has image upload with ImagePlus icon", () => {
    expect(createForm).toContain("<ImagePlus");
  });

  it("enforces the 4MB event image limit in the UI", () => {
    expect(createForm).toContain("MAX_EVENT_IMAGE_BYTES");
    expect(createForm).toContain("4 * 1024 * 1024");
  });

  it("accepts a title from the composer without the draft restore clobbering it", () => {
    expect(createForm).toContain("useState(initialTitle)");
    expect(createForm).toContain("!initialTitle");
  });

  it("focuses the field the composer chip named", () => {
    expect(createForm).toContain("focusField");
    expect(createForm).toContain("target.current?.focus()");
  });
});

describe("RegionMapPicker – design tokens", () => {
  it("does not use legacy card classes", () => {
    expect(regionPicker).not.toContain("ios-card");
  });

  it("uses bg-bg-secondary for card background", () => {
    expect(regionPicker).toContain("bg-bg-secondary");
  });

  it("uses border-white/[0.06] for borders", () => {
    expect(regionPicker).toContain("border-white/[0.06]");
  });
});
