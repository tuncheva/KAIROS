import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * EventFeed component tests — verify the Instagram-style layout,
 * absence of legacy card classes, and proper design token usage.
 * 
 * Since EventFeed relies heavily on tRPC hooks, we test the source code
 * statically for class patterns, and test the sub-components that can render.
 */

const eventFeedPath = path.resolve(__dirname, "../../src/components/events/EventFeed.tsx");
const eventFeedSource = fs.readFileSync(eventFeedPath, "utf-8");

const createFormPath = path.resolve(__dirname, "../../src/components/events/CreateEventForm.tsx");
const createFormSource = fs.readFileSync(createFormPath, "utf-8");

const regionPickerPath = path.resolve(__dirname, "../../src/components/events/RegionMapPicker.tsx");
const regionPickerSource = fs.readFileSync(regionPickerPath, "utf-8");

describe("EventFeed – Instagram Layout", () => {
  describe("Source code analysis", () => {
    it("does not use legacy card classes", () => {
      expect(eventFeedSource).not.toContain("ios-card");
    });

    it("does not use legacy elevated card classes", () => {
      expect(eventFeedSource).not.toContain("ios-card-elevated");
    });

    it("does not use legacy header classes", () => {
      expect(eventFeedSource).not.toContain("ios-header");
    });

    it("does not import Send icon (removed unused import)", () => {
      // Send icon was removed since we replaced the send button with "Post" text
      expect(eventFeedSource).not.toMatch(/\bSend\b/);
    });

    it("uses border-white/[0.06] for subtle borders", () => {
      expect(eventFeedSource).toContain("border-white/[0.06]");
    });

    it("uses bg-bg-secondary for card backgrounds", () => {
      expect(eventFeedSource).toContain("bg-bg-secondary");
    });

    it("uses bg-bg-secondary for card surfaces", () => {
      expect(eventFeedSource).toContain("bg-bg-secondary");
    });

    it("EventCard has Instagram-style author header with accent avatar", () => {
      expect(eventFeedSource).toContain("bg-accent-primary/20");
    });

    it("EventCard has action bar with Heart icon", () => {
      expect(eventFeedSource).toContain("<Heart");
    });

    it("EventCard has action bar with MessageCircle icon", () => {
      expect(eventFeedSource).toContain("<MessageCircle");
    });

    it("EventCard uses inline comment style (author name + text)", () => {
      // Instagram-style: <span font-semibold>author</span><span>comment text</span>
      expect(eventFeedSource).toContain('font-semibold text-fg-primary mr-1.5');
    });

    it("EventCard has 'View all' comments toggle", () => {
      expect(eventFeedSource).toContain("viewAllComments");
    });

    it("Comment input shows 'Post' button text", () => {
      expect(eventFeedSource).toContain('t("post")');
    });

    it("Comment input uses borderless transparent style", () => {
      expect(eventFeedSource).toContain("bg-transparent");
      expect(eventFeedSource).toContain("text-sm");
    });

    it("RSVP section uses compact layout with pill buttons", () => {
      expect(eventFeedSource).toContain("rounded-lg text-xs font-medium");
    });

    it("has RSVP reminder picker UI", () => {
      expect(eventFeedSource).toContain("getNotified");
    });

    it("has reminder timing options (30 min, 1 hour, 1 day, etc.)", () => {
      expect(eventFeedSource).toContain('"30 min"');
      expect(eventFeedSource).toContain('"1 hour"');
      expect(eventFeedSource).toContain('"1 day"');
      expect(eventFeedSource).toContain('"3 days"');
    });

    it("has Bell icon for notification picker", () => {
      expect(eventFeedSource).toContain("<Bell");
    });

    it("Like count is displayed with font-semibold", () => {
      expect(eventFeedSource).toContain("text-xs font-semibold");
    });

    it("uses full-bleed images with object-cover", () => {
      // Image should use object-cover for proper fitting
      expect(eventFeedSource).toContain("object-cover");
    });
  });
});

describe("CreateEventForm – Design Tokens", () => {
  it("does not use legacy card classes", () => {
    expect(createFormSource).not.toContain("ios-card");
  });

  it("does not use legacy elevated card classes", () => {
    expect(createFormSource).not.toContain("ios-card-elevated");
  });

  it("uses bg-transparent for input backgrounds", () => {
    expect(createFormSource).toContain("bg-transparent");
  });

  it("uses borderless input style", () => {
    expect(createFormSource).toContain("border-none");
  });

  it("has a Publish Event submit button", () => {
    expect(createFormSource).toContain("publishEvent");
  });

  it("uses accent-primary for submit button", () => {
    expect(createFormSource).toContain("bg-accent-primary");
  });

  it("has image upload with ImagePlus icon", () => {
    expect(createFormSource).toContain("<ImagePlus");
  });

  it("enforces 4MB event image limit in UI", () => {
    expect(createFormSource).toContain("MAX_EVENT_IMAGE_BYTES");
    expect(createFormSource).toContain("4 * 1024 * 1024");
  });

  it("uses space-y-5 or space-y-3 form layout", () => {
    expect(createFormSource).toMatch(/space-y-[345]/);
  });
});

describe("RegionMapPicker – Design Tokens", () => {
  it("does not use legacy card classes", () => {
    expect(regionPickerSource).not.toContain("ios-card");
  });

  it("uses bg-bg-secondary for card background", () => {
    expect(regionPickerSource).toContain("bg-bg-secondary");
  });

  it("uses border-white/[0.06] for borders", () => {
    expect(regionPickerSource).toContain("border-white/[0.06]");
  });
});
