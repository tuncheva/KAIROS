import { type InferInsertModel, type InferSelectModel, sql } from "drizzle-orm";
import { index, integer } from "drizzle-orm/pg-core";
import { createTable } from "./enums";
import { users } from "./users";
import { projects } from "./projects";
import { organizations } from "./organizations";

export const directConversations = createTable(
  "direct_conversations",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    projectId: d.integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    organizationId: d.integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    userOneId: d
      .varchar("user_one_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userTwoId: d
      .varchar("user_two_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastMessageAt: d.timestamp("last_message_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    createdAt: d.timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: d.timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("direct_convo_project_idx").on(t.projectId),
    index("direct_convo_org_idx").on(t.organizationId),
    index("direct_convo_user_one_idx").on(t.userOneId),
    index("direct_convo_user_two_idx").on(t.userTwoId),
  ]
);

export const directMessages = createTable(
  "direct_messages",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    conversationId: d
      .integer("conversation_id")
      .notNull()
      .references(() => directConversations.id, { onDelete: "cascade" }),
    senderId: d
      .varchar("sender_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: d.text("body").notNull(),
    createdAt: d.timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("direct_msg_conversation_idx").on(t.conversationId),
    index("direct_msg_sender_idx").on(t.senderId),
    index("direct_msg_created_idx").on(t.createdAt),
  ]
);

export type DirectConversation = InferSelectModel<typeof directConversations>;
export type NewDirectConversation = InferInsertModel<typeof directConversations>;
export type DirectMessage = InferSelectModel<typeof directMessages>;
export type NewDirectMessage = InferInsertModel<typeof directMessages>;
