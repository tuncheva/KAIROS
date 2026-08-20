import { sql } from "drizzle-orm";
import { index, text, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import {
  createTable,
  agentTaskPlannerDraftStatusEnum,
  agentNotesVaultDraftStatusEnum,
  agentEventsPublisherDraftStatusEnum,
  aiMessageRoleEnum,
} from "./enums";
import { users } from "./users";
import { projects } from "./projects";

export const agentTaskPlannerDrafts = createTable(
  "agent_task_planner_drafts",
  (d) => ({
    id: varchar("id", { length: 80 }).primaryKey(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    planJson: text("plan_json").notNull(),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    status: agentTaskPlannerDraftStatusEnum("status").notNull().default("draft"),
    confirmationToken: text("confirmation_token"),
    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    appliedAt: timestamp("applied_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
  }),
  (t) => [
    index("a2_draft_user_idx").on(t.userId),
    index("a2_draft_project_idx").on(t.projectId),
    index("a2_draft_status_idx").on(t.status),
    index("a2_draft_plan_hash_idx").on(t.planHash),
  ],
);

export const agentTaskPlannerApplies = createTable(
  "agent_task_planner_applies",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    draftId: varchar("draft_id", { length: 80 })
      .notNull()
      .references(() => agentTaskPlannerDrafts.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("a2_apply_draft_idx").on(t.draftId),
    index("a2_apply_user_idx").on(t.userId),
    index("a2_apply_project_idx").on(t.projectId),
    index("a2_apply_plan_hash_idx").on(t.planHash),
  ],
);

export const agentNotesVaultDrafts = createTable(
  "agent_notes_vault_drafts",
  (d) => ({
    id: varchar("id", { length: 80 }).primaryKey(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    planJson: text("plan_json").notNull(),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    status: agentNotesVaultDraftStatusEnum("status").notNull().default("draft"),
    confirmationToken: text("confirmation_token"),
    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    appliedAt: timestamp("applied_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
  }),
  (t) => [
    index("a3_draft_user_idx").on(t.userId),
    index("a3_draft_status_idx").on(t.status),
    index("a3_draft_plan_hash_idx").on(t.planHash),
  ],
);

export const agentNotesVaultApplies = createTable(
  "agent_notes_vault_applies",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    draftId: varchar("draft_id", { length: 80 })
      .notNull()
      .references(() => agentNotesVaultDrafts.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("a3_apply_draft_idx").on(t.draftId),
    index("a3_apply_user_idx").on(t.userId),
    index("a3_apply_plan_hash_idx").on(t.planHash),
  ],
);

/**
 * A4 event drafts.
 *
 * These lived in a module-level `Map` in the orchestrator, which meant a draft
 * did not survive a restart, was invisible to any other instance, and was never
 * evicted — a user who confirmed after a redeploy got "Draft not found", and the
 * map grew for the lifetime of the process. Same shape as the A2/A3 tables so all
 * three agents have one storage story.
 */
export const agentEventsPublisherDrafts = createTable(
  "agent_events_publisher_drafts",
  (d) => ({
    id: varchar("id", { length: 80 }).primaryKey(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    planJson: text("plan_json").notNull(),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    status: agentEventsPublisherDraftStatusEnum("status").notNull().default("draft"),
    confirmationToken: text("confirmation_token"),
    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    appliedAt: timestamp("applied_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
  }),
  (t) => [
    index("a4_draft_user_idx").on(t.userId),
    index("a4_draft_status_idx").on(t.status),
    index("a4_draft_plan_hash_idx").on(t.planHash),
  ],
);

export const agentEventsPublisherApplies = createTable(
  "agent_events_publisher_applies",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    draftId: varchar("draft_id", { length: 80 })
      .notNull()
      .references(() => agentEventsPublisherDrafts.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("a4_apply_draft_idx").on(t.draftId),
    index("a4_apply_user_idx").on(t.userId),
    index("a4_apply_plan_hash_idx").on(t.planHash),
  ],
);

/**
 * Persisted AI conversations.
 *
 * The chat used to live entirely in React state, so a reload lost it and the
 * "history" sent back to the model was the *rendered* bubble text — including
 * strings like "3 creates · 2 updates 👇 You can edit the details below". A
 * follow-up such as "yes, do it" had nothing real to refer to.
 *
 * The token and latency columns exist so a quality or spend regression can be
 * investigated after the fact rather than reproduced by hand.
 */
export const aiConversations = createTable(
  "ai_conversations",
  (d) => ({
    id: varchar("id", { length: 80 }).primaryKey(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 256 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("ai_conversation_user_idx").on(t.userId),
    index("ai_conversation_project_idx").on(t.projectId),
    index("ai_conversation_updated_idx").on(t.updatedAt),
  ],
);

export const aiMessages = createTable(
  "ai_messages",
  (_d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    conversationId: varchar("conversation_id", { length: 80 })
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    /** Which agent produced an assistant message: A1, or the sub-agent it handed to. */
    agentId: varchar("agent_id", { length: 40 }),
    /** Links the message to the draft whose Apply button it rendered. */
    draftId: varchar("draft_id", { length: 80 }),
    /** Tool calls requested by this message, as the model returned them. */
    toolCallsJson: text("tool_calls_json"),
    model: varchar("model", { length: 120 }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("ai_message_conversation_idx").on(t.conversationId),
    index("ai_message_created_idx").on(t.createdAt),
  ],
);
