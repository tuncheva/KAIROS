-- Two unrelated pieces of database hygiene, both verified against the live
-- database before being written.

-- ── 1. Real uniqueness where the names already promised it ──────────────────
--
-- `rsvp_unique` was created with CREATE INDEX, not CREATE UNIQUE INDEX, despite
-- the name — so the check-then-insert in `event.updateRsvp` could race into two
-- RSVPs for one person and the feed would count them twice.
--
-- `organization_members` had no uniqueness on (organization_id, user_id) at all.
-- That matters more now than it did: the eight permission columns are the source
-- of truth for authorization, and two membership rows means two different answers
-- to "what may this person do here".
--
-- Verified zero duplicates in both tables before applying. The index is rebuilt
-- rather than altered because Postgres cannot promote a non-unique index in place.

DROP INDEX IF EXISTS "rsvp_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rsvp_unique" ON "event_rsvp" USING btree ("event_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_member_unique" ON "organization_members" USING btree ("organization_id","user_id");
--> statement-breakpoint

-- ── 2. Drop tables no code declares ────────────────────────────────────────
--
-- These six exist in the deployed database but not in schema.ts, so a database
-- provisioned from the migrations never had them and nothing in the application
-- reads or writes them. They are the residue of an earlier AI-usage design.
--
-- Dropped on an explicit decision, not as part of a sync: `ai_conversations` and
-- `ai_messages` held two rows each and that data is destroyed here. The other four
-- were empty. CASCADE because they reference each other and `user`.

DROP TABLE IF EXISTS "ai_usage_events" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "ai_daily_budget" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "ai_messages" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "ai_conversations" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_write_plan_applies" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_write_plans" CASCADE;
