-- Phase 4 of the events rebuild: what kind of thing it is, how many fit, and
-- who else is running it.
--
-- Hand-written for the journal-timestamp reason described in 0030 and 0032.
--
-- `capacity` null means unlimited, which is every event that predates it, so
-- nothing can retroactively sell out. `topic` null means unfiled, and the feed
-- treats that as "matches no topic filter" rather than hiding the row.

DO $$ BEGIN
 CREATE TYPE "event_topic" AS ENUM('tech', 'music', 'food', 'sport', 'art', 'business', 'education', 'community');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "topic" "event_topic";--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "capacity" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_topic_idx" ON "event" ("topic");--> statement-breakpoint

-- A co-host has the host's edit rights and appears on the page beside them.
-- Deletion is deliberately not among those rights: `created_by_id` still owns
-- that, so being added as a co-host cannot cost you your event.
CREATE TABLE IF NOT EXISTS "event_cohost" (
	"event_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_cohost_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_cohost" ADD CONSTRAINT "event_cohost_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_cohost" ADD CONSTRAINT "event_cohost_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cohost_user_idx" ON "event_cohost" ("user_id");
