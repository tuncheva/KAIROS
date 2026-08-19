import { type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { index, primaryKey, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createTable, regionEnum, rsvpStatusEnum } from "./enums";
import { users } from "./users";

export const events = createTable(
  "event",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: d.varchar("title", { length: 256 }).notNull(),
    description: d.text("description").notNull(),
    imageUrl: d.text("image_url"),
    eventDate: d.timestamp("event_date", { mode: "date", withTimezone: true }).notNull(),
    region: regionEnum("region").notNull(),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enableRsvp: d.boolean("enable_rsvp").notNull().default(false),
    sendReminders: d.boolean("send_reminders").notNull().default(false),
    reminderSent: d.boolean("reminder_sent").notNull().default(false),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index("event_created_by_idx").on(t.createdById),
    index("event_date_idx").on(t.eventDate),
    index("event_region_idx").on(t.region),
  ],
);

export const eventRsvps = createTable(
  "event_rsvp",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    eventId: d
      .integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: rsvpStatusEnum("status").notNull(),
    reminderMinutesBefore: d.integer("reminder_minutes_before"),
    reminderSent: d.boolean("reminder_sent").notNull().default(false),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index("rsvp_event_idx").on(t.eventId),
    index("rsvp_user_idx").on(t.userId),
    // Was a plain `index()` despite the name, so nothing stopped a duplicate RSVP —
    // the check-then-insert in `event.updateRsvp` could race into two rows for one
    // user, and the feed would then count that person twice.
    uniqueIndex("rsvp_unique").on(t.eventId, t.userId),
  ]
);

export const eventComments = createTable(
  "event_comment",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    text: d.text("text").notNull(),
    imageUrl: d.text("image_url"),
    eventId: d
      .integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index("comment_event_id_idx").on(t.eventId),
    index("comment_created_by_idx").on(t.createdById),
  ],
);

export const eventLikes = createTable(
  "event_like",
  (d) => ({
    eventId: d
      .integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.eventId, t.createdById] }),
    index("like_event_id_idx").on(t.eventId),
  ],
);

export type Event = InferSelectModel<typeof events>;
export type NewEvent = InferInsertModel<typeof events>;
export type EventRsvp = InferSelectModel<typeof eventRsvps>;
export type NewEventRsvp = InferInsertModel<typeof eventRsvps>;
