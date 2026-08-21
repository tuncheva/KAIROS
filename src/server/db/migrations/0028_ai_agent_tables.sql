CREATE TYPE "public"."agent_org_admin_draft_status" AS ENUM('draft', 'confirmed', 'applied', 'expired');--> statement-breakpoint
ALTER TYPE "public"."ai_message_role" ADD VALUE IF NOT EXISTS 'system';--> statement-breakpoint
CREATE TABLE "agent_org_admin_applies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_org_admin_applies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"draft_id" varchar(80) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"result_json" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_org_admin_drafts" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"plan_json" text NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"status" "agent_org_admin_draft_status" DEFAULT 'draft' NOT NULL,
	"confirmation_token" text,
	"confirmed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_findings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar(255) NOT NULL,
	"project_id" integer,
	"fingerprint" varchar(128) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"title" varchar(256) NOT NULL,
	"detail" text NOT NULL,
	"suggested_draft_id" varchar(80),
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"dismissed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar(255) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"hour_utc" integer DEFAULT 7 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_user_memory" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_user_memory_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar(255) NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" text NOT NULL,
	"source_conversation_id" varchar(80),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "summarized_through_id" integer;--> statement-breakpoint
ALTER TABLE "agent_org_admin_applies" ADD CONSTRAINT "agent_org_admin_applies_draft_id_agent_org_admin_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_org_admin_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_org_admin_applies" ADD CONSTRAINT "agent_org_admin_applies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_org_admin_drafts" ADD CONSTRAINT "agent_org_admin_drafts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_findings" ADD CONSTRAINT "ai_findings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_findings" ADD CONSTRAINT "ai_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_schedules" ADD CONSTRAINT "ai_schedules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_user_memory" ADD CONSTRAINT "ai_user_memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "a5_apply_draft_idx" ON "agent_org_admin_applies" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "a5_apply_user_idx" ON "agent_org_admin_applies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a5_draft_user_idx" ON "agent_org_admin_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a5_draft_status_idx" ON "agent_org_admin_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a5_draft_plan_hash_idx" ON "agent_org_admin_drafts" USING btree ("plan_hash");--> statement-breakpoint
CREATE INDEX "ai_finding_user_idx" ON "ai_findings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_finding_status_idx" ON "ai_findings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_finding_fingerprint_unique" ON "ai_findings" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "ai_schedule_user_idx" ON "ai_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_schedule_due_idx" ON "ai_schedules" USING btree ("enabled","hour_utc");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_schedule_user_kind_unique" ON "ai_schedules" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "ai_memory_user_idx" ON "ai_user_memory" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_memory_user_key_unique" ON "ai_user_memory" USING btree ("user_id","key");
