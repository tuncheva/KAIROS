import { sql } from "drizzle-orm";
import { index, text, timestamp, uniqueIndex, varchar, integer } from "drizzle-orm/pg-core";
import { createTable, shareStatusEnum, permissionEnum } from "./enums";
import { users } from "./users";

export const notebooks = createTable(
  "notebooks",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 256 }).notNull(),
    description: text("description"),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("notebook_created_by_idx").on(t.createdById),
  ]
);

export const stickyNotes = createTable(
  "sticky_notes",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: varchar("title", { length: 256 }),
    content: text("content").notNull(),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notebookId: integer("notebook_id").references(() => notebooks.id, { onDelete: "set null" }),
    /**
     * When set, the note should appear on the calendar at this date/time.
     * Null means it's a regular note (not scheduled for calendar).
     */
    calendarDate: timestamp("calendar_date"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    passwordHash: varchar("password_hash", { length: 256 }),
    passwordSalt: varchar("password_salt", { length: 256 }),
    shareStatus: shareStatusEnum("share_status").notNull(),
    publicId: varchar("public_id", { length: 21 }),
    // embedding vector(1536) — managed by migration 0041, queried via raw sql in searchTools.ts
  }),
  (t) => [
    index("note_created_by_idx").on(t.createdById),
    index("note_notebook_idx").on(t.notebookId),
    index("note_calendar_date_idx").on(t.calendarDate),
    uniqueIndex("note_public_id_idx").on(t.publicId),
  ]
);

export const noteShares = createTable(
  "note_shares",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    noteId: integer("note_id")
      .notNull()
      .references(() => stickyNotes.id, { onDelete: "cascade" }),
    sharedWithId: d
      .varchar("shared_with_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permission: permissionEnum("permission").notNull().default("read"),
    sharedById: d
      .varchar("shared_by_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("note_share_note_idx").on(t.noteId),
    index("note_share_user_idx").on(t.sharedWithId),
  ]
);

