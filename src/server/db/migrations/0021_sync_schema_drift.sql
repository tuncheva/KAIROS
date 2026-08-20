-- Close the gap between schema.ts and the deployed database.
--
-- Found by introspecting the live database and diffing it, table by table and
-- column by column, against a baseline generated from schema.ts. Nothing had ever
-- verified that the two agreed, and they did not.
--
-- The serious one is `user.two_factor_secret`. It is declared in schema.ts but was
-- never deployed, and Drizzle's relational query API selects every declared
-- column — so `db.query.users.findFirst()` failed outright with
-- `column "two_factor_secret" does not exist`. That call is on the signup path
-- (`auth.signup`), both password-reset paths (`auth.requestPasswordReset`,
-- `auth.resetPassword`), the note PIN path, `settings.get`, and the inviter and
-- notification lookups. Signup and password recovery were broken in production.
--
-- `task_comments` is the same class of problem: declared in schema.ts and wired
-- into `relations.ts`, never created in the database. Nothing queries it yet, so
-- it had not surfaced — a relational query touching `tasks.comments` would have
-- failed the same way.
--
-- Every statement is guarded, so this applies equally to the live database and to
-- a database built from the baseline (where these objects already exist).
--
-- NOT addressed here, deliberately: the database also holds six tables and
-- several columns that schema.ts does not declare (`ai_conversations`,
-- `ai_messages`, `agent_write_plans`, `agent_write_plan_applies`,
-- `ai_daily_budget`, `ai_usage_events`, `event.stream_*`, `event.event_type`,
-- `organization_invites.token_hash` / `used_at` / `used_by_user_id`). Some hold
-- rows. Dropping them is a product decision, not a sync, and is left to whoever
-- knows whether that data matters.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_secret" varchar(255);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content" text NOT NULL,
	"task_id" integer NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk"
		FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_createdById_user_id_fk"
		FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comment_task_idx" ON "task_comments" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comment_user_idx" ON "task_comments" USING btree ("createdById");
--> statement-breakpoint
-- schema.ts declares this NOT NULL and the application has always written it;
-- the column was created nullable. Verified zero null rows before tightening.
ALTER TABLE "organization_invites" ALTER COLUMN "email" SET NOT NULL;
