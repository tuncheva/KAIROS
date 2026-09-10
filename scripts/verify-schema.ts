/**
 * Confirm that migrations reached the database.
 *
 * Not paranoia. `drizzle-kit migrate` reports success for a migration it
 * *skipped* — which is exactly the failure this project hit on every migration
 * before `fix-migration-journal.ts` existed. "Applied successfully" and "the
 * column is there" were different facts, and only one of them was checked.
 *
 * Run after a migrate against a database that matters.
 */

import postgres from "postgres";

const TABLES = [
  "ai_custom_schedules",
  "api_keys",
  "webhooks",
  "webhook_deliveries",
  "documents",
  "verification_code",
  "document_chunks",
  "calendar_connections",
  "external_events",
];

const COLUMNS: Array<[string, string]> = [
  ["ai_schedules", "day_of_week"],
  ["ai_schedules", "channel"],
  ["ai_schedules", "channel_failures"],
  ["agent_task_planner_applies", "before_json"],
  ["agent_notes_vault_applies", "before_json"],
  ["agent_events_publisher_applies", "before_json"],
  ["agent_org_admin_applies", "before_json"],
  // Notification preferences. Every one of these gates a category in
  // `~/server/notifications/dispatch`; a missing column means the dispatcher's
  // SELECT throws and no notification of any kind is delivered.
  ["user", "in_app_notifications"],
  ["user", "direct_message_notifications"],
  ["user", "task_assignment_notifications"],
  ["user", "event_updates_notifications"],
  ["user", "event_rsvp_notifications"],
  ["user", "social_notifications"],
  ["user", "invite_notifications"],
  ["user", "workspace_notifications"],
  // Where the on-screen notifications go. Missing, `settings.get` returns a row
  // without it, the picker falls back to the default, and the user's choice
  // silently stops sticking rather than failing.
  ["user", "notification_position"],
  // The subscribable calendar feed's credential. Missing, every subscription
  // URL a user has already given to Google or Apple stops resolving.
  ["user", "calendar_feed_token"],
  // Idempotency for the task due-reminder sweep. Without it the sweep cannot
  // tell a reminder it already sent from one it has not, so it sends every tick.
  ["tasks", "due_reminder_sent_at"],
  // Meeting prep's idempotence key: without it an hourly sweep briefs the same
  // meeting on every tick inside the horizon.
  ["external_events", "prepped_at"],
  // The pgvector columns from 0044_pgvector_embeddings. These are the reason this
  // section exists: they live in raw SQL rather than the Drizzle schema, so
  // `db:push` cannot create them and their absence is invisible to every other
  // check. All three were missing from the live database for the entire life of
  // the feature. Their width is asserted separately below.
  ["document_chunks", "embedding"],
  ["tasks", "embedding"],
  ["sticky_notes", "embedding"],
];

/**
 * Foreign keys and unique constraints that only a migration creates.
 *
 * `task_dependencies`, `ai_reminders` and the two A6 tables were found in
 * production carrying a primary key and nothing else — no FKs, so deleting a user
 * or task left orphan rows behind where the code assumes ON DELETE CASCADE, and
 * no `task_dep_unique`, so a dependency edge could be inserted twice.
 */
const CONSTRAINTS = [
  "agent_project_manager_drafts_user_id_user_id_fk",
  "agent_project_manager_applies_draft_id_fk",
  "agent_project_manager_applies_user_id_user_id_fk",
  "task_dependencies_blocked_task_id_tasks_id_fk",
  "task_dependencies_blocking_task_id_tasks_id_fk",
  "task_dependencies_created_by_id_user_id_fk",
  "ai_reminders_user_id_user_id_fk",
];

/** Extensions a migration installs. Absent, every vector query fails outright. */
const EXTENSIONS = ["vector"];

/** Must match DEFAULT_EMBEDDING_DIMS in ~/server/llm/core/embeddings.ts. */
const EMBEDDING_DIMS = 1024;

/** Enum values added alongside a feature are as skippable as a column. */
const ENUM_VALUES: Array<[string, string]> = [
  ["notification_type", "message"],
  ["notification_type", "event_reminder"],
  ["verification_code_purpose", "email_verify"],
];

const INDEXES = [
  "ai_message_content_fts_idx",
  "document_chunk_fts_idx",
  "verification_code_lookup_idx",
  // From 0041. `task_dep_unique` is the only thing stopping a dependency edge
  // being inserted twice, and `ai_reminder_fire_at_idx` is what keeps the
  // reminder sweep off a sequential scan on every tick. Both were missing.
  "task_dep_blocked_idx",
  "task_dep_blocking_idx",
  "task_dep_unique",
  "ai_reminder_user_idx",
  "ai_reminder_fire_at_idx",
  "a6_draft_user_idx",
  "a6_draft_status_idx",
  "a6_draft_plan_hash_idx",
  "a6_apply_draft_idx",
  "a6_apply_user_idx",
  // The HNSW indexes from 0044. Without them vector search still returns correct
  // results, by exhaustive scan — correct and unusably slow, which is the kind of
  // regression no test notices.
  "document_chunk_embedding_idx",
  "task_embedding_idx",
  "note_embedding_idx",
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("No DATABASE_URL configured");

  const sql = postgres(url, { max: 1, prepare: false });
  let missing = 0;

  try {
    for (const table of TABLES) {
      const rows = await sql<{ present: boolean }[]>`
        SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`;
      const ok = rows[0]?.present ?? false;
      if (!ok) missing += 1;
      console.log(`table   ${table.padEnd(32)} ${ok ? "OK" : "MISSING"}`);
    }

    for (const [table, column] of COLUMNS) {
      const rows = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}`;
      const ok = rows.length > 0;
      if (!ok) missing += 1;
      console.log(`column  ${`${table}.${column}`.padEnd(32)} ${ok ? "OK" : "MISSING"}`);
    }

    for (const [enumName, value] of ENUM_VALUES) {
      const rows = await sql`
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${enumName} AND e.enumlabel = ${value}`;
      const ok = rows.length > 0;
      if (!ok) missing += 1;
      console.log(`enum    ${`${enumName}.${value}`.padEnd(32)} ${ok ? "OK" : "MISSING"}`);
    }

    for (const index of INDEXES) {
      const rows = await sql`SELECT 1 FROM pg_indexes WHERE indexname = ${index}`;
      const ok = rows.length > 0;
      if (!ok) missing += 1;
      console.log(`index   ${index.padEnd(32)} ${ok ? "OK" : "MISSING"}`);
    }

    for (const extension of EXTENSIONS) {
      const rows = await sql`SELECT 1 FROM pg_extension WHERE extname = ${extension}`;
      const ok = rows.length > 0;
      if (!ok) missing += 1;
      console.log(`ext     ${extension.padEnd(32)} ${ok ? "OK" : "MISSING"}`);
    }

    for (const constraint of CONSTRAINTS) {
      const rows = await sql`SELECT 1 FROM pg_constraint WHERE conname = ${constraint}`;
      const ok = rows.length > 0;
      if (!ok) missing += 1;
      console.log(`constr  ${constraint.slice(0, 32).padEnd(32)} ${ok ? "OK" : "MISSING"}`);
    }

    // A vector column of the wrong width is worse than a missing one: it passes
    // the column check above and then rejects every insert at runtime, because
    // pgvector fixes the dimension at the column rather than at query time.
    for (const table of ["document_chunks", "tasks", "sticky_notes"]) {
      const [row] = await sql<{ type: string }[]>`
        SELECT format_type(a.atttypid, a.atttypmod) AS type
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = ${table} AND a.attname = 'embedding'
          AND a.attnum > 0 AND NOT a.attisdropped`;
      const expected = `vector(${String(EMBEDDING_DIMS)})`;
      const ok = row?.type === expected;
      if (!ok) missing += 1;
      console.log(
        `dims    ${`${table}.embedding`.padEnd(32)} ${ok ? "OK" : `EXPECTED ${expected}, GOT ${row?.type ?? "nothing"}`}`,
      );
    }

    // The full-text index is only used if the query's configuration matches the
    // index's exactly. A mismatch is silent: correct results, sequential scan.
    const [fts] = await sql<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes
      WHERE indexname = 'document_chunk_fts_idx'`;
    if (fts) {
      const usesSimple = fts.def.includes("'simple'");
      if (!usesSimple) missing += 1;
      console.log(
        `config  ${"document FTS uses 'simple'".padEnd(32)} ${usesSimple ? "OK" : "MISMATCH"}`,
      );
    }

    console.log(missing === 0 ? "\nAll present." : `\n${String(missing)} missing.`);
  } finally {
    await sql.end();
  }
}

await main();
