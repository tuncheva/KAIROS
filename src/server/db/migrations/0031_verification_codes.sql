-- Hashed, purpose-tagged verification codes.
--
-- Replaces `password_reset_code`, whose codes were stored in plaintext. The old
-- table is left in place and simply stops being written to: its rows expire in
-- fifteen minutes, so it is empty of anything usable within the hour and can be
-- dropped in a later migration once no deployment still runs the old code.
--
-- Hand-written, like 0030 — `db:generate` stamps the journal with `Date.now()`,
-- which is behind this repo's hand-set timestamps, and `drizzle-kit migrate`
-- then skips the file silently. See `scripts/fix-migration-journal.ts`.

DO $$ BEGIN
 CREATE TYPE "verification_code_purpose" AS ENUM('email_verify', 'password_reset');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "verification_code" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"purpose" "verification_code_purpose" NOT NULL,
	"email" varchar(255) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "verification_code_lookup_idx" ON "verification_code" ("email","purpose");
