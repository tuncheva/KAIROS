-- "Edited" as a fact a guest can see.
--
-- Hand-written for the journal-timestamp reason described in 0030.
--
-- Deliberately nullable with no default and no backfill: defaulting it to
-- `created_at` would stamp every event ever published as edited on the day this
-- ran, which is exactly the sort of lie that teaches people to ignore the label.
-- Null means never edited, and the first real edit is the first time it moves.

ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
