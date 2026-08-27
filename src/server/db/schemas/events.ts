import { type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { index, primaryKey, integer, uniqueIndex } from "drizzle-orm/pg-core";
import {
  createTable,
  eventCoverEnum,
  eventTopicEnum,
  regionEnum,
  rsvpStatusEnum,
} from "./enums";
import { users } from "./users";

export const events = createTable(
  "event",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: d.varchar("title", { length: 256 }).notNull(),
    description: d.text("description").notNull(),
    imageUrl: d.text("image_url"),
    eventDate: d.timestamp("event_date", { mode: "date", withTimezone: true }).notNull(),
    /**
     * When it is over. Null means "we only know when it starts", which is every
     * row written before this column existed.
     *
     * Banding reads `coalesce(ends_at, event_date)`, so a three-day conference
     * stops filing itself under "already happened" on its opening morning.
     */
    endsAt: d.timestamp("ends_at", { mode: "date", withTimezone: true }),
    region: regionEnum("region").notNull(),
    /** The building. `region` says which town; this says where in it. */
    venue: d.varchar("venue", { length: 160 }),
    address: d.varchar("address", { length: 255 }),
    /** Null means unlimited, which is every event that predates the column. */
    capacity: d.integer("capacity"),
    topic: eventTopicEnum("topic"),
    /**
     * The wash behind the event where a photograph would go.
     *
     * Null is not "no colour": the view derives one from the id, so every event
     * written before this column existed still has a cover. Setting it is how a
     * host overrides that choice.
     */
    coverTheme: eventCoverEnum("cover_theme"),
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
    /**
     * When the host last changed something a guest would care about.
     *
     * Null means "never edited", which is every row written before this column
     * existed — deliberately not defaulted to `createdAt`, because that would
     * mark the whole back catalogue as edited on the day of the migration.
     *
     * Only material edits move it. A fixed typo is not something the forty
     * people who already said yes need to be told about; a moved date is.
     */
    updatedAt: d.timestamp("updated_at", { withTimezone: true }),
  }),
  (t) => [
    index("event_created_by_idx").on(t.createdById),
    index("event_date_idx").on(t.eventDate),
    index("event_region_idx").on(t.region),
    index("event_topic_idx").on(t.topic),
    // Discovery pages forward through time, not backwards through creation, so
    // its cursor needs the other ordering — and both halves of it, or two events
    // starting at the same minute would page unstably.
    index("event_date_id_idx").on(t.eventDate, t.id),
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
    /**
     * One level of replies, not a tree.
     *
     * A reply to a reply sets `parent_id` to the top-level comment it hangs
     * under, so rendering never has to recurse and a thread cannot nest itself
     * off the right edge of a phone.
     */
    parentId: d.integer("parent_id"),
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
    index("comment_parent_idx").on(t.parentId),
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

/**
 * Co-hosts.
 *
 * The create form has offered "Tag Collaborators" since it was written, with no
 * handler behind the button. A co-host is someone with the host's edit rights
 * who appears on the event page beside them — not a guest, and not an owner:
 * `created_by_id` still decides who can delete.
 */
export const eventCoHosts = createTable(
  "event_cohost",
  (d) => ({
    eventId: d
      .integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    index("cohost_user_idx").on(t.userId),
  ],
);

/**
 * Bookmarks.
 *
 * Distinct from an RSVP on purpose: "I want to remember this" is not "I am
 * coming", and people have been using *Maybe* to say the first, which corrupts
 * the count the host reads.
 */
export const eventSaves = createTable(
  "event_save",
  (d) => ({
    eventId: d
      .integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    index("save_user_idx").on(t.userId),
  ],
);

export type Event = InferSelectModel<typeof events>;
export type NewEvent = InferInsertModel<typeof events>;
export type EventRsvp = InferSelectModel<typeof eventRsvps>;
export type NewEventRsvp = InferInsertModel<typeof eventRsvps>;
export type EventCoHost = InferSelectModel<typeof eventCoHosts>;
export type EventSave = InferSelectModel<typeof eventSaves>;
