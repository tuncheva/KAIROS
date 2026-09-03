DO $$ BEGIN
 CREATE TYPE "notification_position" AS ENUM('top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "notification_position" "notification_position" DEFAULT 'top-right' NOT NULL;
