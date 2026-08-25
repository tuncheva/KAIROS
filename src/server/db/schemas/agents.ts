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
    /**
     * The affected rows as they were immediately before this apply ran.
     *
     * The gap this closes: the apply tables recorded *which* rows were touched
     * and never their prior contents, so `undo.ts` could delete what was created
     * and had nothing to restore an edit from. Two features were blocked by the
     * same missing column — a real rollback, and a field-level preview of what a
     * plan is about to change.
     *
     * Captured by reading the rows before mutating them, not inside a database
     * transaction: the apply path is a sequence of statements rather than a
     * transaction today. A crash mid-apply can therefore leave a before-image
     * describing rows that were only partly changed, which is still strictly more
     * than existed before — and making the apply transactional is a separate
     * change with its own risks.
     *
     * Size-capped at the capture site. A plan touching hundreds of rows stores a
     * truncation marker rather than the lot, or these tables become the largest
     * in the database.
     */
    beforeJson: text("before_json"),
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
    /**
     * The affected rows as they were immediately before this apply ran.
     *
     * The gap this closes: the apply tables recorded *which* rows were touched
     * and never their prior contents, so `undo.ts` could delete what was created
     * and had nothing to restore an edit from. Two features were blocked by the
     * same missing column — a real rollback, and a field-level preview of what a
     * plan is about to change.
     *
     * Captured by reading the rows before mutating them, not inside a database
     * transaction: the apply path is a sequence of statements rather than a
     * transaction today. A crash mid-apply can therefore leave a before-image
     * describing rows that were only partly changed, which is still strictly more
     * than existed before — and making the apply transactional is a separate
     * change with its own risks.
     *
     * Size-capped at the capture site. A plan touching hundreds of rows stores a
     * truncation marker rather than the lot, or these tables become the largest
     * in the database.
     */
    beforeJson: text("before_json"),
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
    /**
     * The affected rows as they were immediately before this apply ran.
     *
     * The gap this closes: the apply tables recorded *which* rows were touched
     * and never their prior contents, so `undo.ts` could delete what was created
     * and had nothing to restore an edit from. Two features were blocked by the
     * same missing column — a real rollback, and a field-level preview of what a
     * plan is about to change.
     *
     * Captured by reading the rows before mutating them, not inside a database
     * transaction: the apply path is a sequence of statements rather than a
     * transaction today. A crash mid-apply can therefore leave a before-image
     * describing rows that were only partly changed, which is still strictly more
     * than existed before — and making the apply transactional is a separate
     * change with its own risks.
     *
     * Size-capped at the capture site. A plan touching hundreds of rows stores a
     * truncation marker rather than the lot, or these tables become the largest
     * in the database.
     */
    beforeJson: text("before_json"),
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
    /**
     * Full-text search over message bodies.
     *
     * The `'simple'` configuration, not `'english'`. English stemming applied to
     * Bulgarian text is worse than no stemming — it mangles tokens it does not
     * recognise — and this product's launch market writes in Cyrillic. `simple`
     * lowercases and splits on word boundaries and does nothing language-specific,
     * which is the only behaviour that is equally correct across all five locales.
     *
     * The configuration here must stay identical to the one in the query
     * (`retention.ts`): Postgres will not use this index for a `to_tsvector` call
     * with a different config, and the search would silently fall back to a
     * sequential scan over every message in the table.
     */
    index("ai_message_content_fts_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.content})`,
    ),
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
    /**
     * "daily_brief" | "risk_radar" | "weekly_retro".
     *
     * Kept as text so adding a kind is not a migration — which is exactly how the
     * weekly retrospective was added.
     */
    kind: varchar("kind", { length: 40 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /**
     * Hour of day (0-23) the user wants it, in *their* zone.
     *
     * The physical column is still `hour_utc` — the name it was given when the
     * value really was interpreted as UTC. Renaming the column is a migration
     * that buys nothing at runtime, so the lie is corrected where it was
     * actually read: `users.timezone` now decides what this hour means, and a
     * separate rename can follow once nothing is mid-flight against the old name.
     */
    hourLocal: integer("hour_utc").notNull().default(7),
    /**
     * Which weekday it runs on (0 = Sunday … 6 = Saturday), or NULL for daily.
     *
     * Nullable rather than defaulted so the two existing kinds keep their meaning
     * without a backfill: every row written before the weekly retrospective
     * existed is daily, and NULL says exactly that. A default of 0 would have
     * silently converted every daily brief in the database into a Sunday-only one.
     *
     * Interpreted in the user's zone, like `hourLocal` — asking "is it Friday?"
     * of a UTC clock is the same mistake, one dimension up.
     */
    dayOfWeek: integer("day_of_week"),
    /**
     * Where the result is delivered: `app` | `email` | `both`.
     *
     * Defaults to `app`, which is what every existing row means. Text rather than
     * an enum for the same reason `kind` is: adding Slack should not be a
     * migration, and the runner already has to tolerate a value it does not
     * recognise.
     */
    channel: varchar("channel", { length: 16 }).notNull().default("app"),
    /**
     * Consecutive delivery failures on the chosen channel.
     *
     * Only meaningful for channels that can fail independently of the app — a
     * bounced address, a revoked API key. Reset to zero on any success, so this
     * counts a run of failures rather than a lifetime total: three in a row is
     * evidence the address is dead, where three across six months is evidence of
     * nothing.
     *
     * Without this, a mistyped address generates a bounce every single morning
     * forever, and the only person who finds out is whoever reads the logs.
     */
    channelFailures: integer("channel_failures").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("ai_schedule_user_idx").on(t.userId),
    // Only `enabled` is still a SQL predicate: the hour comparison moved to JS
    // when it became zone-dependent. The index is left covering both columns —
    // the leading column is the one that filters, and dropping the trailing one
    // is a migration with no measurable win at this table's size.
    index("ai_schedule_due_idx").on(t.enabled, t.hourLocal),
    uniqueIndex("ai_schedule_user_kind_unique").on(t.userId, t.kind),
  ],
);

/**
 * Schedules of the user's own devising.
 *
 * A separate table from `ai_schedules` rather than a nullable `prompt` column on
 * it. The two are the same shape and different things: a built-in kind has a
 * fixed fact-collection path in code and no prompt at all, where a custom one is
 * a saved question and nothing else. Merging them would mean every read of either
 * branches on which sort of row it found, and the runner's `RUNNERS` map — which
 * exists so adding a kind is one line — would need a special case for "the kind
 * that is actually a prompt".
 *
 * What these runs may do is the security-relevant part, and it is enforced in the
 * runner rather than here: the prompt executes against A1's **read-only** tool
 * set with no write tools bound. A schedule that fires while nobody is watching
 * must not be able to create, change or delete anything, and A1's read-only
 * invariant is exactly that property, already established and already tested.
 */
export const aiCustomSchedules = createTable(
  "ai_custom_schedules",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the user calls it, for the settings list and the notification title. */
    name: varchar("name", { length: 80 }).notNull(),
    /**
     * The question, in the user's own words.
     *
     * Bounded hard. This is injected into a prompt on a timer, so an unbounded
     * column would be a way to make every future run arbitrarily expensive, and
     * a schedule is meant to be a question rather than a document.
     */
    prompt: text("prompt").notNull(),
    /** 0 = Sunday … 6 = Saturday, or NULL for daily. Same convention as `ai_schedules`. */
    dayOfWeek: integer("day_of_week"),
    hourLocal: integer("hour_local").notNull().default(8),
    channel: varchar("channel", { length: 16 }).notNull().default("app"),
    channelFailures: integer("channel_failures").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("ai_custom_schedule_user_idx").on(t.userId),
    index("ai_custom_schedule_due_idx").on(t.enabled),
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
    /**
     * The affected rows as they were immediately before this apply ran.
     *
     * The gap this closes: the apply tables recorded *which* rows were touched
     * and never their prior contents, so `undo.ts` could delete what was created
     * and had nothing to restore an edit from. Two features were blocked by the
     * same missing column — a real rollback, and a field-level preview of what a
     * plan is about to change.
     *
     * Captured by reading the rows before mutating them, not inside a database
     * transaction: the apply path is a sequence of statements rather than a
     * transaction today. A crash mid-apply can therefore leave a before-image
     * describing rows that were only partly changed, which is still strictly more
     * than existed before — and making the apply transactional is a separate
     * change with its own risks.
     *
     * Size-capped at the capture site. A plan touching hundreds of rows stores a
     * truncation marker rather than the lot, or these tables become the largest
     * in the database.
     */
    beforeJson: text("before_json"),
    resultJson: text("result_json").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("a5_apply_draft_idx").on(t.draftId),
    index("a5_apply_user_idx").on(t.userId),
  ],
);

/**
 * API keys — programmatic access to the caller's own workspace.
 *
 * The complement to custom tools: today the agent can call out and nothing can
 * call in. A key authenticates as exactly one user and grants nothing that user
 * does not already have, because every procedure it reaches runs the same
 * authorization it runs for a browser session.
 *
 * **The hash is SHA-256, not argon2**, and that is a deliberate departure from
 * how passwords are stored two tables over. A password is low-entropy and
 * human-chosen, so the slow KDF exists to make guessing expensive. An API key is
 * 32 bytes from `randomBytes` — there is nothing to guess, and the only thing a
 * deliberately slow hash would achieve is ~100ms of argon2 on every single API
 * request, which is a self-inflicted denial of service. Fast hash, high entropy.
 *
 * `prefix` is stored in clear so a key can be *found* without being reversible:
 * verification looks the row up by prefix and then compares hashes in constant
 * time, rather than reading every key in the table on every request.
 */
export const apiKeys = createTable(
  "api_keys",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the user calls it: "CI", "my laptop script". */
    label: varchar("label", { length: 80 }).notNull(),
    /**
     * The first characters of the key, in clear.
     *
     * Not a secret — it is shown in the UI so a user can tell which key a row is
     * without being able to use it, which is the whole reason keys are displayed
     * as `kai_a1b2…` everywhere after creation.
     */
    prefix: varchar("prefix", { length: 16 }).notNull(),
    /** SHA-256 of the full key, hex. See the note above on why not argon2. */
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    /**
     * When it was last used to authenticate.
     *
     * Written lazily — see `apiKeys.ts` — because a strict update on every
     * request would turn a read-only API call into a write and make this row the
     * hottest in the database.
     */
    lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true }),
    /**
     * Revocation, as a timestamp rather than a delete.
     *
     * A deleted key row cannot answer "was this key ever used, and when did we
     * stop trusting it?", which is the first question after a leak.
     */
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("api_key_user_idx").on(t.userId),
    // The lookup path: find by prefix, then compare the hash. Unique because two
    // live keys sharing a prefix would make that lookup ambiguous.
    uniqueIndex("api_key_prefix_unique").on(t.prefix),
  ],
);

/**
 * Outbound webhooks.
 *
 * `secret` is stored so deliveries can be signed. It is a shared secret by
 * necessity — the receiver needs the same value to verify — which is why it is
 * generated here rather than chosen by the user, and shown once.
 */
export const webhooks = createTable(
  "webhooks",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Shared secret for the HMAC signature. */
    secret: varchar("secret", { length: 64 }).notNull(),
    /**
     * Which events to send, comma-separated, or empty for all.
     *
     * Text rather than a join table: the set is small, it is read whole on every
     * dispatch, and nothing ever queries "which webhooks want event X" except the
     * dispatcher, which already has every row in hand.
     */
    events: text("events").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Consecutive delivery failures, same convention as `ai_schedules`.
     *
     * Reset on any success. An endpoint that has been refusing for a week is
     * either gone or broken, and continuing to post to it every time anything
     * happens is how a webhook becomes an outbound flood nobody asked for.
     */
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [index("webhook_user_idx").on(t.userId)],
);

/**
 * What was delivered, and what came back.
 *
 * Not optional. An undeliverable webhook with no visible history is
 * unsupportable — the only available answer to "why did my endpoint not fire?"
 * would be to read the server logs, which the user cannot do.
 */
export const webhookDeliveries = createTable(
  "webhook_deliveries",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    webhookId: integer("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 64 }).notNull(),
    /** HTTP status, or null when the request never completed. */
    statusCode: integer("status_code"),
    /** How many attempts this delivery took, including the successful one. */
    attempts: integer("attempts").notNull().default(1),
    /** Truncated response or error text, for diagnosis. */
    detail: text("detail"),
    ok: boolean("ok").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("webhook_delivery_webhook_idx").on(t.webhookId),
    index("webhook_delivery_created_idx").on(t.createdAt),
  ],
);

/**
 * Documents the agents may read.
 *
 * Only metadata lives here — the bytes stay with the upload provider, which
 * already has the storage, the CDN and the auth for them. What this table adds is
 * ownership, scope, and the extraction status a user needs to understand why a
 * freshly uploaded file is not yet searchable.
 */
export const documents = createTable(
  "documents",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Optional project scope.
     *
     * Null means "mine, everywhere". A document attached to a project is visible
     * to whoever can see the project, which is what makes uploading a spec useful
     * to a team rather than only to the person who had the file.
     */
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    filename: varchar("filename", { length: 256 }).notNull(),
    /** The upload provider's key, for fetching and for deletion. */
    storageKey: text("storage_key").notNull(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** `pending` | `ready` | `failed` | `no_text`. */
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    /**
     * Why extraction failed, or why a file produced no text.
     *
     * `no_text` is a distinct outcome from `failed` and the distinction matters to
     * the user: an image-only scan is not broken, it just needs OCR, which is not
     * in scope. Telling someone "failed" when the honest answer is "this PDF has
     * no text layer" sends them to support instead of to a different file.
     */
    error: text("error"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count").notNull().default(0),
    /** True when the document was longer than the chunk cap allows. */
    truncated: boolean("truncated").notNull().default(false),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("document_user_idx").on(t.userId),
    index("document_project_idx").on(t.projectId),
  ],
);

/**
 * The retrievable passages of a document.
 *
 * Searched by Postgres full-text today. That is a deliberate first step rather
 * than the intended end state: it matches words, so "how do I cancel" will not
 * find "termination clause", where an embedding would. It was chosen because it
 * needs no extension, no embedding model and no inference on upload — and
 * because inference on upload is a spend shape nothing else in this product has,
 * which matters while the AI layer runs on free provider tiers.
 *
 * The seam for vectors is deliberately left open: adding a nullable `embedding`
 * column and a second index changes nothing above this table. `searchDocuments`
 * is the only caller, so swapping or combining the two is one function.
 *
 * `'simple'` rather than `'english'`, and the configuration must stay identical
 * to the one in the query — see the note on `ai_message_content_fts_idx`.
 */
export const documentChunks = createTable(
  "document_chunks",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Denormalised from `documents` so search can scope without a join. */
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    /** Page the passage starts on, for citation. Null when unknown. */
    page: integer("page"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("document_chunk_document_idx").on(t.documentId),
    index("document_chunk_user_idx").on(t.userId),
    uniqueIndex("document_chunk_ordinal_unique").on(t.documentId, t.ordinal),
    index("document_chunk_fts_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.content})`,
    ),
  ],
);

/**
 * A connected external calendar.
 *
 * **Read-only import, deliberately.** Two-way sync is where the cost and the risk
 * of this feature live — conflict resolution, write-back loops, and the question
 * of what happens when both sides changed. Import alone answers the question
 * users actually have ("the assistant does not know about my real meetings") and
 * is what unlocks meeting-prep briefs. Writing back can follow once the read path
 * has proven itself against real calendars.
 *
 * **Consent is separate from sign-in.** The NextAuth Google provider asks for
 * `openid profile email` and nothing more, and that stays true: asking every new
 * user for calendar access at signup is over-asking, and it costs conversions.
 * Calendar scope is granted through its own flow, which is also what lets someone
 * disconnect their calendar without signing out of the product.
 *
 * Tokens are encrypted at rest with a per-row salt. `accounts` stores sign-in
 * tokens in clear because NextAuth owns that table and its shape; these are ours,
 * they grant access to a user's entire calendar, and there is no reason for them
 * to be readable in a database dump.
 */
export const calendarConnections = createTable(
  "calendar_connections",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `google` today; `microsoft` is the same shape with a different endpoint. */
    provider: varchar("provider", { length: 32 }).notNull(),
    /** The calendar account, so the UI can say *which* account is connected. */
    accountEmail: varchar("account_email", { length: 255 }),
    /** Encrypted. See `calendar/tokens.ts`. */
    accessToken: text("access_token").notNull(),
    /**
     * Encrypted, and the one that matters.
     *
     * Google only returns a refresh token on the *first* consent unless
     * `prompt=consent` is forced, so losing this means the user has to
     * re-authorise. It is never overwritten with null on a refresh response that
     * omits it — see `refreshAccessToken`.
     */
    refreshToken: text("refresh_token"),
    /** Per-row salt, so one leaked ciphertext does not help with any other. */
    tokenSalt: varchar("token_salt", { length: 64 }).notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    /**
     * Google's incremental sync token.
     *
     * The whole reason a sync is cheap after the first one: it returns only what
     * changed. Google invalidates it after a while and answers `410 Gone`, which
     * is not an error — it means "start again", and the sync handles it by
     * clearing this and doing a full pull.
     */
    syncToken: text("sync_token"),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    /** Consecutive sync failures, same convention as `ai_schedules`. */
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("calendar_connection_user_idx").on(t.userId),
    // One connection per provider per user. Reconnecting updates in place rather
    // than accumulating rows whose tokens all still work.
    uniqueIndex("calendar_connection_user_provider_unique").on(
      t.userId,
      t.provider,
    ),
  ],
);

/**
 * Events imported from a connected calendar.
 *
 * A separate table from `events`, which is the product's own noticeboard —
 * user-authored, RSVP-able, publishable. An imported event is none of those: it
 * is a read-only shadow of something that lives elsewhere, it must disappear when
 * the calendar says it was cancelled, and it must never be editable here. Merging
 * the two would mean every query on `events` growing a "but not the imported
 * ones" clause, and the first one that forgot would let a user delete a meeting
 * out of their real calendar's shadow and wonder why it came back.
 */
export const externalEvents = createTable(
  "external_events",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    userId: d
      .varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The provider's own id, for incremental updates and deletions. */
    externalId: varchar("external_id", { length: 256 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    location: text("location"),
    startsAt: timestamp("starts_at", { mode: "date", withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { mode: "date", withTimezone: true }),
    /** True for a date-only event, where the times carry no meaning. */
    allDay: boolean("all_day").notNull().default(false),
    /**
     * `confirmed` | `tentative` | `cancelled`.
     *
     * Cancelled rows are kept rather than deleted, briefly: an incremental sync
     * reports a cancellation as a status change, and a meeting-prep brief that
     * already mentioned the meeting should be able to say it is off.
     */
    status: varchar("status", { length: 16 }).notNull().default("confirmed"),
    /** How many people are on it — enough for a brief without storing the list. */
    attendeeCount: integer("attendee_count"),
    /** Whether the calendar owner has accepted, for "your meetings" filtering. */
    selfResponse: varchar("self_response", { length: 16 }),
    /**
     * When a meeting-prep brief covered this meeting.
     *
     * The idempotence key for meeting prep. The sweep runs hourly against a
     * 90-minute horizon, so without this a meeting two hours out is briefed on
     * this tick and briefed again on the next — and the second message says
     * nothing the first did not.
     *
     * A fact about the meeting rather than state on the schedule row: it survives
     * the user turning prep off and on again, which is the behaviour someone would
     * expect from "you already told me about this one".
     */
    preppedAt: timestamp("prepped_at", { mode: "date", withTimezone: true }),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (t) => [
    index("external_event_user_idx").on(t.userId),
    index("external_event_starts_idx").on(t.startsAt),
    uniqueIndex("external_event_connection_external_unique").on(
      t.connectionId,
      t.externalId,
    ),
  ],
);
