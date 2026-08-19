import { type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { index, integer } from "drizzle-orm/pg-core";
import { createTable, notificationTypeEnum } from "./enums";
import { users } from "./users";

export const notifications = createTable(
  "notifications",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: d.varchar("title", { length: 256 }).notNull(),
    message: d.text("message").notNull(),
    link: d.varchar("link", { length: 512 }),
    read: d.boolean("read").notNull().default(false),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index("notification_user_idx").on(t.userId),
    index("notification_read_idx").on(t.read),
    index("notification_created_idx").on(t.createdAt),
  ]
);

export type Notification = InferSelectModel<typeof notifications>;
export type NewNotification = InferInsertModel<typeof notifications>;
