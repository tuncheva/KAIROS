ALTER TYPE "public"."notification_type" ADD VALUE 'message';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'event_reminder';--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_connections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar(255) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"account_email" varchar(255),
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_salt" varchar(64) NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "external_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connection_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'confirmed' NOT NULL,
	"attendee_count" integer,
	"self_response" varchar(16),
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "event_reminders_notifications" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "in_app_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "direct_message_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "task_assignment_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "event_updates_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "event_rsvp_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "social_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invite_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "workspace_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_connection_user_idx" ON "calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connection_user_provider_unique" ON "calendar_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "external_event_user_idx" ON "external_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "external_event_starts_idx" ON "external_events" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_event_connection_external_unique" ON "external_events" USING btree ("connection_id","external_id");