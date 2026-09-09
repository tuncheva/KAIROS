-- Backfill public_id for all existing rows that were created before the column existed.
--
-- Uses gen_random_uuid() (built-in since Postgres 13, no extension needed) stripped
-- to 21 URL-safe hex characters. New rows get their publicId at insert time via the
-- application code; this only touches rows where public_id IS NULL.

UPDATE "sticky_notes"
SET "public_id" = left(replace(gen_random_uuid()::text, '-', ''), 21)
WHERE "public_id" IS NULL;
--> statement-breakpoint

UPDATE "direct_conversations"
SET "public_id" = left(replace(gen_random_uuid()::text, '-', ''), 21)
WHERE "public_id" IS NULL;
