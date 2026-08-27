-- Phase 3 of the events rebuild: an event that can be arrived at, and a
-- comment that can be replied to.
--
-- Written by hand rather than generated. `db:generate` stamps the journal entry
-- with `Date.now()`, which is *behind* this repo's hand-set timestamps, and
-- `drizzle-kit migrate` then skips the file silently — see
-- `scripts/fix-migration-journal.ts`. The matching journal entry is appended
-- with a `when` above every prior entry.
--
-- Every column here is nullable. `region` remains the only required location,
-- so every row written before today stays valid and reads exactly as it did.

ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "venue" varchar(160);--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "address" varchar(255);--> statement-breakpoint

-- One level of replies. A reply to a reply points at the top-level comment it
-- hangs under, so nothing recurses and no thread can nest off the screen.
ALTER TABLE "event_comment" ADD COLUMN IF NOT EXISTS "parent_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_comment" ADD CONSTRAINT "event_comment_parent_id_event_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "event_comment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_parent_idx" ON "event_comment" ("parent_id");--> statement-breakpoint

-- Discovery pages forward through time rather than backwards through creation,
-- so its cursor needs both halves of the other ordering.
CREATE INDEX IF NOT EXISTS "event_date_id_idx" ON "event" ("event_date","id");
