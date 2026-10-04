import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const eventRouterPath = path.resolve(
  __dirname,
  "../../src/server/api/routers/event.ts"
);
const eventRouterSource = fs.readFileSync(eventRouterPath, "utf-8");

const schemaIndexPath = path.resolve(
  __dirname,
  "../../src/server/db/schema.ts"
);
fs.readFileSync(schemaIndexPath, "utf-8");

const schemasPath = path.resolve(
  __dirname,
  "../../src/server/db/schemas/index.ts"
);
const schemasIndexSource = fs.readFileSync(schemasPath, "utf-8");

const enumsPath = path.resolve(
  __dirname,
  "../../src/server/db/schemas/enums.ts"
);
const enumsSource = fs.readFileSync(enumsPath, "utf-8");

const eventsSchemaPath = path.resolve(
  __dirname,
  "../../src/server/db/schemas/events.ts"
);
const eventsSchemaSource = fs.readFileSync(eventsSchemaPath, "utf-8");

const sweepPath = path.resolve(
  __dirname,
  "../../src/server/notifications/eventReminders.ts"
);
const sweepSource = fs.readFileSync(sweepPath, "utf-8");

// The wording lives in a module shared with the AI events agent, so the router
// and the agent cannot drift apart; the router only calls into it.
const noticesSource = fs.readFileSync(
  path.resolve(__dirname, "../../src/server/notifications/eventNotices.ts"),
  "utf-8",
);

describe("Event Router – Notifications", () => {
  it("routes event notices through the shared helpers", () => {
    expect(eventRouterSource).toContain("notifyEventComment(");
    expect(eventRouterSource).toContain("notifyEventLike(");
  });

  it("creates a notification on comment (for event owner)", () => {
    expect(noticesSource).toContain("New comment on your event");
  });

  it("notifies the author of the comment being replied to", () => {
    expect(noticesSource).toContain('type: "reply"');
    expect(noticesSource).toContain("New reply to your comment");
  });

  it("creates a notification on like (for event owner)", () => {
    expect(noticesSource).toContain("New like on your event");
  });

  it("does not notify when liking own post", () => {
    expect(noticesSource).toContain("eventRow.createdById === input.actorId");
  });

  it("uses 'comment' notification type for comments", () => {
    expect(noticesSource).toContain('type: "comment"');
  });

  it("uses 'like' notification type for likes", () => {
    expect(noticesSource).toContain('type: "like"');
  });
});

describe("Event Router – RSVP Reminders", () => {
  it("updateRsvp schema accepts reminderMinutesBefore", () => {
    expect(eventRouterSource).toContain("reminderMinutesBefore");
  });

  it("saves reminderMinutesBefore on RSVP insert", () => {
    expect(eventRouterSource).toContain("reminderMinutesBefore: input.reminderMinutesBefore");
  });

  it("resets reminderSent flag when reminder preference changes", () => {
    expect(eventRouterSource).toContain("reminderSent: false");
  });

  /**
   * The row could be written for an event that had already happened, and the
   * sweep would never look at it again — a reminder the UI confirmed and
   * nothing could ever send.
   */
  it("refuses to arm a reminder on an event that is over", () => {
    expect(eventRouterSource).toContain(
      'typeof input.reminderMinutesBefore === "number"'
    );
    expect(eventRouterSource).toContain("already happened");
  });

  it("measures staleness from when the event ends, not when it starts", () => {
    expect(sweepSource).toContain("COALESCE(${events.endsAt}, ${events.eventDate})");
    expect(sweepSource).toContain("STALE_AFTER_MS");
  });
});

describe("Schema – Notification Types", () => {
  it("exports enums from schemas index", () => {
    expect(schemasIndexSource).toContain("export * from \"./enums\"");
  });

  it("has like notification type in enum", () => {
    expect(enumsSource).toContain("notificationTypeEnum");
    expect(enumsSource).toContain("like");
  });

  it("has comment notification type in enum", () => {
    expect(enumsSource).toContain("notificationTypeEnum");
    expect(enumsSource).toContain("comment");
  });

  it("has reply notification type in enum", () => {
    expect(enumsSource).toContain("notificationTypeEnum");
    expect(enumsSource).toContain("reply");
  });

  it("eventRsvps has reminderMinutesBefore column", () => {
    expect(eventsSchemaSource).toContain("reminderMinutesBefore");
    expect(eventsSchemaSource).toContain("reminder_minutes_before");
  });

  it("eventRsvps has reminderSent column", () => {
    expect(eventsSchemaSource).toContain("reminderSent");
    expect(eventsSchemaSource).toContain("reminder_sent");
  });
});
