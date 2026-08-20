-- Durable failed-sign-in counters, so the lockout survives a restart.
--
-- The sliding-window limiter added earlier is the first line of defence, but it
-- keeps state in process memory unless REDIS_NATIVE_URL is configured. A deploy,
-- a crash, or a second app instance therefore hands an attacker a fresh attempt
-- budget. These columns mirror the reset-PIN lockout that already existed on this
-- table (reset_pin_failed_attempts / reset_pin_locked_until) and outlive all of
-- that.
--
-- Additive and guarded, so it applies to the deployed database and to one built
-- from the baseline alike.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "login_failed_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "login_locked_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "login_last_failed_at" timestamp with time zone;
