import { type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { index, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createTable } from "./enums";
import { users } from "./users";

/**
 * One Web Push subscription per browser/device a user enabled push on.
 *
 * `endpoint` is unique rather than `(user, endpoint)`: a push endpoint names a
 * browser install, not a person, so when somebody signs into another account on
 * the same phone the row moves to them instead of both accounts receiving.
 */
export const pushSubscriptions = createTable(
  "push_subscriptions",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: d.text("endpoint").notNull(),
    p256dh: d.text("p256dh").notNull(),
    auth: d.text("auth").notNull(),
    userAgent: d.varchar("user_agent", { length: 512 }),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    lastSuccessAt: d.timestamp("last_success_at", { withTimezone: true }),
  }),
  (t) => [
    uniqueIndex("push_subscription_endpoint_idx").on(t.endpoint),
    index("push_subscription_user_idx").on(t.userId),
  ],
);

export type PushSubscriptionRow = InferSelectModel<typeof pushSubscriptions>;
export type NewPushSubscriptionRow = InferInsertModel<typeof pushSubscriptions>;
