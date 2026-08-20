DO $$ BEGIN
  CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant', 'tool', 'system');
EXCEPTION WHEN duplicate_object THEN
  -- Already present from an earlier, abandoned AI schema iteration. It is
  -- used by no column, and its values already cover what this migration
  -- needs, so adopt it rather than drop and recreate a live type.
  NULL;
END $$;--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"project_id" integer,
	"title" varchar(256),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" varchar(80) NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"agent_id" varchar(40),
	"draft_id" varchar(80),
	"tool_calls_json" text,
	"model" varchar(120),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_user_idx" ON "ai_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_project_idx" ON "ai_conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_updated_idx" ON "ai_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ai_message_conversation_idx" ON "ai_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_message_created_idx" ON "ai_messages" USING btree ("created_at");