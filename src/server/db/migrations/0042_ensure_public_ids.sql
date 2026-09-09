-- Ensure public_id columns are present on sticky_notes and direct_conversations.
--
-- These were added by 0041_phase1_4_features but that migration also contained
-- CREATE EXTENSION vector which may have caused drizzle-kit to abort early on
-- instances where pgvector isn't available. This migration is purely DDL on
-- core types and is guaranteed idempotent via IF NOT EXISTS.
ALTER TABLE "sticky_notes"
  ADD COLUMN IF NOT EXISTS "public_id" varchar(21);
--> statement-breakpoint
ALTER TABLE "direct_conversations"
  ADD COLUMN IF NOT EXISTS "public_id" varchar(21);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "note_public_id_idx"
  ON "sticky_notes" USING btree ("public_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_convo_public_id_idx"
  ON "direct_conversations" USING btree ("public_id");
