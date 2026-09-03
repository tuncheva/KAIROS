ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "calendar_feed_token" varchar(64);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user" ADD CONSTRAINT "user_calendar_feed_token_unique" UNIQUE("calendar_feed_token");
EXCEPTION
 WHEN duplicate_table THEN null;
 WHEN duplicate_object THEN null;
END $$;
