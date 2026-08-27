ALTER TABLE "ai_schedules" ADD COLUMN "channel" varchar(16) DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_schedules" ADD COLUMN "channel_failures" integer DEFAULT 0 NOT NULL;