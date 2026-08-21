DROP INDEX "ai_memory_user_key_unique";--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "pinned_agent_id" varchar(40);--> statement-breakpoint
ALTER TABLE "ai_user_memory" ADD COLUMN "scope" varchar(40) DEFAULT 'global' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_memory_user_scope_key_unique" ON "ai_user_memory" USING btree ("user_id","scope","key");