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
  // Idempotency for the task due-reminder sweep. Without it the sweep cannot
  // tell a reminder it already sent from one it has not, so it sends every tick.
  ["tasks", "due_reminder_sent_at"],
  // Meeting prep's idempotence key: without it an hourly sweep briefs the same
  // meeting on every tick inside the horizon.
  ["external_events", "prepped_at"],
];

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
