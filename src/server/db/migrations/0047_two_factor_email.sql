-- Two-step sign-in by email.
--
-- `user.two_factor_enabled` has existed since the settings screen was built,
-- but nothing read it. This adds what enforcing it needs: a code purpose for
-- turning it on and off from Settings, and a table for sign-ins that have
-- passed the password and are waiting on the emailed code or link.
--
-- Additive only. Every account keeps `two_factor_enabled = false`, so nobody's
-- sign-in changes until they turn it on.
--
-- `ADD VALUE` is safe inside the migration transaction on Postgres 12+ as long
-- as nothing in the same transaction uses the new value, and nothing here does.

ALTER TYPE "verification_code_purpose" ADD VALUE IF NOT EXISTS 'two_factor_toggle';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "two_factor_challenge" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"link_token_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "two_factor_challenge_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "two_factor_challenge_link_token_hash_unique" UNIQUE("link_token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "two_factor_challenge" ADD CONSTRAINT "two_factor_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_challenge_user_idx" ON "two_factor_challenge" ("user_id");
