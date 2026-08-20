DO $$ BEGIN
  CREATE TYPE "public"."agent_events_publisher_draft_status" AS ENUM('draft', 'confirmed', 'applied', 'expired');
EXCEPTION WHEN duplicate_object THEN
  -- Already present from an earlier, abandoned AI schema iteration. It is
  -- used by no column, and its values already cover what this migration
  -- needs, so adopt it rather than drop and recreate a live type.
  NULL;
END $$;--> statement-breakpoint
CREATE TABLE "agent_events_publisher_applies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_events_publisher_applies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"draft_id" varchar(80) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"result_json" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_events_publisher_drafts" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"plan_json" text NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"status" "agent_events_publisher_draft_status" DEFAULT 'draft' NOT NULL,
	"confirmation_token" text,
	"confirmed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_events_publisher_applies" ADD CONSTRAINT "agent_events_publisher_applies_draft_id_agent_events_publisher_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_events_publisher_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events_publisher_applies" ADD CONSTRAINT "agent_events_publisher_applies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events_publisher_drafts" ADD CONSTRAINT "agent_events_publisher_drafts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "a4_apply_draft_idx" ON "agent_events_publisher_applies" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "a4_apply_user_idx" ON "agent_events_publisher_applies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a4_apply_plan_hash_idx" ON "agent_events_publisher_applies" USING btree ("plan_hash");--> statement-breakpoint
CREATE INDEX "a4_draft_user_idx" ON "agent_events_publisher_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a4_draft_status_idx" ON "agent_events_publisher_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a4_draft_plan_hash_idx" ON "agent_events_publisher_drafts" USING btree ("plan_hash");