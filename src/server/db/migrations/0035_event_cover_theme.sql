-- A colour for events that have no photograph, which is most of them.
--
-- Hand-written for the journal-timestamp reason described in 0030: `db:generate`
-- stamps entries with `Date.now()`, which is behind this repo's hand-set values,
-- and `drizzle-kit migrate` then skips the file in silence.
--
-- Nullable, and null does not mean "grey": the view derives a wash from the
-- event id when the column is empty, so every row written before today comes
-- out coloured. Setting it is how a host overrides that derived choice — which
-- is why it is stored rather than computed from the id everywhere.

DO $$ BEGIN
 CREATE TYPE "event_cover" AS ENUM('dusk', 'ember', 'meadow', 'blush', 'sand', 'tide');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "cover_theme" "event_cover";
