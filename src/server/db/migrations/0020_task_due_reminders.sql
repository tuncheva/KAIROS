ALTER TABLE "tasks" ADD COLUMN "due_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_events" ADD COLUMN "prepped_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "task_due_reminder_idx" ON "tasks" USING btree ("due_date","due_reminder_sent_at");