import { type InferInsertModel, type InferSelectModel, sql } from "drizzle-orm";
import { type AnyPgColumn, index, integer, uniqueIndex } from "drizzle-orm/pg-core";
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
    /* Self-reference for replies. `set null` rather than cascade: deleting the
       quoted message must not take every reply to it with it — the reply still
       reads fine, it just loses its quote block. */
    replyToId: d
      .integer("reply_to_id")
      .references((): AnyPgColumn => directMessages.id, { onDelete: "set null" }),
    editedAt: d.timestamp("edited_at"),
    /* Soft delete. The row survives as a tombstone so `reply_to_id` pointers and
       the id sequence that read pointers walk stay intact. */
    deletedAt: d.timestamp("deleted_at"),
    pinnedAt: d.timestamp("pinned_at"),
    pinnedBy: d
      .varchar("pinned_by", { length: 255 })
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: d.timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("direct_msg_conversation_idx").on(t.conversationId),
    index("direct_msg_sender_idx").on(t.senderId),
    index("direct_msg_created_idx").on(t.createdAt),
    index("direct_msg_reply_to_idx").on(t.replyToId),
    /* Partial index: the pinned-messages panel reads one conversation's pins,
       and pinned rows are a rounding error against total message volume. */
    index("direct_msg_pinned_idx")
      .on(t.conversationId)
      .where(sql`${t.pinnedAt} is not null`),
  ]
);

/**
 * Per-person state on a conversation.
 *
 * `direct_conversations` stores its two members as columns on the conversation
 * itself, which leaves nowhere to hang anything that is true for one participant
 * and not the other — where they have read up to, whether they muted it, whether
 * they archived it, how much history they cleared. That is why unread counts,
 * read receipts and a non-destructive delete could not exist.
 *
 * Rows are created alongside the conversation and backfilled for existing ones
 * (migration 0030). `user_one_id`/`user_two_id` stay authoritative for the pair
 * lookup in `getOrCreateDirectConversation` for now; this table is additive.
 */
export const conversationParticipants = createTable(
  "conversation_participants",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    conversationId: d
      .integer("conversation_id")
      .notNull()
      .references(() => directConversations.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /* Deliberately not a foreign key. It is a high-water mark, not a
       relationship: if the message it points at is hard-deleted the pointer is
       still meaningful (everything at or below that id is read), whereas an FK
       would either null it out and mark the whole thread unread again, or block
       the delete. Same reasoning for `cleared_before`. */
    lastReadMessageId: d.integer("last_read_message_id"),
    clearedBefore: d.integer("cleared_before"),
    mutedUntil: d.timestamp("muted_until"),
    archivedAt: d.timestamp("archived_at"),
    joinedAt: d.timestamp("joined_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    leftAt: d.timestamp("left_at"),
  }),
  (t) => [
    uniqueIndex("conversation_participant_unique").on(t.conversationId, t.userId),
    index("conversation_participant_user_idx").on(t.userId),
  ]
);

/**
 * Attachments as rows rather than URLs concatenated into the message body.
 *
 * The previous scheme appended upload URLs to `body` and re-parsed them on every
 * render with an image-extension regex, so nothing knew a file's name, size or
 * type, and prose containing a link could be mistaken for an upload.
 */
export const directMessageAttachments = createTable(
  "direct_message_attachments",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    messageId: d
      .integer("message_id")
      .notNull()
      .references(() => directMessages.id, { onDelete: "cascade" }),
    url: d.text("url").notNull(),
    name: d.varchar("name", { length: 255 }).notNull(),
    mime: d.varchar("mime", { length: 127 }).notNull(),
    sizeBytes: d.integer("size_bytes").notNull(),
    /* Known for images, null for documents — lets the thread reserve the right
       box before the image loads instead of reflowing when it arrives. */
    width: d.integer("width"),
    height: d.integer("height"),
    createdAt: d.timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [index("direct_msg_attachment_message_idx").on(t.messageId)]
);

/**
 * Emoji reactions. The unique triple is what makes toggling correct: a second
 * insert of the same (message, user, emoji) is a no-op the database refuses
 * rather than a duplicate the count has to de-duplicate later.
 */
export const directMessageReactions = createTable(
  "direct_message_reactions",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    messageId: d
      .integer("message_id")
      .notNull()
      .references(() => directMessages.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: d.varchar("emoji", { length: 32 }).notNull(),
    createdAt: d.timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    uniqueIndex("direct_message_reaction_unique").on(t.messageId, t.userId, t.emoji),
    index("direct_msg_reaction_message_idx").on(t.messageId),
  ]
);

export type DirectConversation = InferSelectModel<typeof directConversations>;
export type NewDirectConversation = InferInsertModel<typeof directConversations>;
export type DirectMessage = InferSelectModel<typeof directMessages>;
export type NewDirectMessage = InferInsertModel<typeof directMessages>;
export type ConversationParticipant = InferSelectModel<typeof conversationParticipants>;
export type NewConversationParticipant = InferInsertModel<typeof conversationParticipants>;
export type DirectMessageAttachment = InferSelectModel<typeof directMessageAttachments>;
export type NewDirectMessageAttachment = InferInsertModel<typeof directMessageAttachments>;
export type DirectMessageReaction = InferSelectModel<typeof directMessageReactions>;
export type NewDirectMessageReaction = InferInsertModel<typeof directMessageReactions>;
