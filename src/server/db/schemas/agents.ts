import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  createTable,
  agentTaskPlannerDraftStatusEnum,
  agentNotesVaultDraftStatusEnum,
  agentEventsPublisherDraftStatusEnum,
  agentOrgAdminDraftStatusEnum,
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
    /**
     * Rolling summary of the turns that have aged out of the replay window.
     *
     * History used to be the last 16 messages, replayed raw: past that, the
     * beginning of a long thread simply vanished mid-conversation, and the model
     * would re-ask something it had already been told. What is folded in here is
     * regenerated as the conversation grows, so the replayed context stays
     * bounded without losing what was established early.
     */
    summary: text("summary"),
    /** How many messages the current `summary` already covers. */
    summarizedThroughId: integer("summarized_through_id"),
    /**
     * The sub-agent the user pinned for this thread, if any.
     *
     * NULL means Auto — A1 routes, which is the default and what every
     * conversation created before the picker existed will read as.
     */
    pinnedAgentId: varchar("pinned_agent_id", { length: 40 }),
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

/**
 * C-2 — durable facts the assistant may carry between conversations.
 *
 * Deliberately small, typed, and owned by the user. The rule that keeps this
 * trustworthy is that nothing writes here by inference: a row exists only
 * because the user asked for it in as many words, through the `rememberFact`
 * tool. Everything is listed and deletable in settings, because a memory you
 * cannot inspect is a memory you cannot trust.
 *
 * `key` is the dedupe handle — asserting a new sprint cadence replaces the old
 * one rather than accumulating two contradictory rows for the model to pick
 * between.
 */
export const aiUserMemory = createTable(
  "ai_user_memory",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Short stable handle, e.g. "sprint_cadence". Unique per user *and scope*. */
    key: varchar("key", { length: 64 }).notNull(),
    /** The fact itself, in the user's own terms. */
    value: text("value").notNull(),
    /**
     * Who this fact is for: `'global'`, or an agent id.
     *
     * A non-null sentinel rather than a nullable `agent_id` on purpose. Postgres
     * treats NULLs as distinct in a unique index, so a nullable column would let
     * two global rows share a key — and the upsert in `rememberFact` reads at
     * most one, so the second would be written and then silently never used.
     * `NULLS NOT DISTINCT` would also work on 15+ but buys nothing here.
     */
    scope: varchar("scope", { length: 40 }).default("global").notNull(),
    /** Which conversation it came from, for "why does it think that?". */
    sourceConversationId: varchar("source_conversation_id", { length: 80 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("ai_memory_user_idx").on(t.userId),
    uniqueIndex("ai_memory_user_scope_key_unique").on(t.userId, t.scope, t.key),
  ],
);

/**
 * B-4 — which proactive runs a user has opted into.
 *
 * Off by default, one row per user per kind, created only when the user turns
 * the feature on. An assistant that starts speaking unprompted because it was
 * deployed is not a feature, it is a notification storm — so the absence of a
 * row means silence.
 *
 * `lastRunAt` is what the scheduler reads to decide whether this user is due;
 * `lastError` exists so a run that has been failing for a week is visible
 * without trawling logs.
 */
export const aiSchedules = createTable(
  "ai_schedules",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "daily_brief" | "risk_radar". Kept as text so adding a kind is not a migration. */
    kind: varchar("kind", { length: 40 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** Local hour of day (0-23) the user wants it. Interpreted in UTC for now. */
    hourUtc: integer("hour_utc").notNull().default(7),
    lastRunAt: timestamp("last_run_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("ai_schedule_user_idx").on(t.userId),
    index("ai_schedule_due_idx").on(t.enabled, t.hourUtc),
    uniqueIndex("ai_schedule_user_kind_unique").on(t.userId, t.kind),
  ],
);

/**
 * B-2/B-3 — findings a scheduled watcher produced, and what became of them.
 *
 * Stored rather than fired straight into notifications for two reasons: the same
 * risk must not be re-reported every morning until it is fixed, and dismissal
 * rate is the metric that decides whether proactive AI is earning its place. A
 * finding nobody ever acts on is noise, and this table is how that becomes
 * visible instead of anecdotal.
 */
export const aiFindings = createTable(
  "ai_findings",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    /** Stable identity for the finding, so the same risk is not raised twice. */
    fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull().default("info"),
    title: varchar("title", { length: 256 }).notNull(),
    detail: text("detail").notNull(),
    /** A2/A3/A4 draft id that fixes this, when the watcher could draft one. */
    suggestedDraftId: varchar("suggested_draft_id", { length: 80 }),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    dismissedAt: timestamp("dismissed_at", { mode: "date", withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("ai_finding_user_idx").on(t.userId),
    index("ai_finding_status_idx").on(t.status),
    uniqueIndex("ai_finding_fingerprint_unique").on(t.userId, t.fingerprint),
  ],
);

/**
 * E-4 — A5 org admin drafts.
 *
 * Same shape as A2/A3/A4 so all four agents have one storage story, one hashing
 * story and one audit story. What differs is upstream: A5's plan schema marks
 * every operation dangerous, and its apply re-checks the caller's capability
 * flags per operation rather than once per plan — a role change is the one write
 * in KAIROS that can hand someone else the ability to make more of them.
 */
export const agentOrgAdminDrafts = createTable(
  "agent_org_admin_drafts",
  (d) => ({
    id: varchar("id", { length: 80 }).primaryKey(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    planJson: text("plan_json").notNull(),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    status: agentOrgAdminDraftStatusEnum("status").notNull().default("draft"),
    confirmationToken: text("confirmation_token"),
    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    appliedAt: timestamp("applied_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
  }),
  (t) => [
    index("a5_draft_user_idx").on(t.userId),
    index("a5_draft_status_idx").on(t.status),
    index("a5_draft_plan_hash_idx").on(t.planHash),
  ],
);

export const agentOrgAdminApplies = createTable(
  "agent_org_admin_applies",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    draftId: varchar("draft_id", { length: 80 })
      .notNull()
      .references(() => agentOrgAdminDrafts.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("a5_apply_draft_idx").on(t.draftId),
    index("a5_apply_user_idx").on(t.userId),
  ],
);
