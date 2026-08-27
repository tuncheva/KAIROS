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
const composer = read("src/components/publish/EventComposer.tsx");
const createForm = read("src/components/events/CreateEventForm.tsx");
const regionPicker = read("src/components/events/RegionMapPicker.tsx");

const panes = { workspace, card, rail, aside, composer };

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

  it("delegates filtering to feedData rather than inlining it in JSX", () => {
    expect(workspace).toContain("selectFeed");
    expect(workspace).toContain("splitByTime");
  });

  it("paginates by intersection observer", () => {
    expect(workspace).toContain("IntersectionObserver");
    expect(workspace).toContain("fetchNextPage");
  });

  it("stays live on the same socket events the old feed listened to", () => {
    expect(workspace).toContain('useSocketEvent("event:deleted"');
    expect(workspace).toContain('useSocketEvent("event:updated"');
  });

  it("takes the counts that depend on you from the server, not the loaded page", () => {
    expect(workspace).toContain("getMySummary");
  });

  it("scrolls a shared /publish?event=ID link to its card", () => {
    expect(workspace).toContain('params.get("event")');
    expect(workspace).toContain("scrollIntoView");
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

  it("keeps comments, with an inline author-then-text line", () => {
    expect(card).toContain("viewAllComments");
    expect(card).toContain("addComment");
    // The author is now wrapped in a `ProfileLink` so tapping the name opens
    // that person's profile, which split the old single class string across
    // two elements. The assertion follows the structure rather than the string:
    // the name is still bold, still inline, and still ahead of the text.
    expect(card).toContain('className="font-semibold text-fg-primary"');
    expect(card).toContain("userId={comment.author.id}");
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
    expect(card).toContain("signInToComment");
  });
});

describe("PublishRail – the ways into the feed", () => {
  it("renders every view the data can actually support", () => {
    expect(rail).toContain("FEED_VIEWS");
  });

  it("keeps the region picker reachable below lg instead of hiding the filter", () => {
    expect(rail).toContain("lg:hidden");
  });

  it("labels the picker for screen readers", () => {
    expect(rail).toContain('aria-label={t("filterByTowns")}');
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

  it("summarises engagement through feedData", () => {
    expect(aside).toContain("summariseEngagement");
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
