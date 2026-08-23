CREATE TABLE "ai_custom_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_custom_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar(255) NOT NULL,
	"name" varchar(80) NOT NULL,
	"prompt" text NOT NULL,
	"day_of_week" integer,
	"hour_local" integer DEFAULT 8 NOT NULL,
	"channel" varchar(16) DEFAULT 'app' NOT NULL,
	"channel_failures" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_custom_schedules" ADD CONSTRAINT "ai_custom_schedules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_custom_schedule_user_idx" ON "ai_custom_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_custom_schedule_due_idx" ON "ai_custom_schedules" USING btree ("enabled");