-- Phase 1–4 capability expansion.
--
-- Hand-written because the drizzle-kit snapshot in meta/ trails the live
-- journal by ~20 migrations (drizzle-kit generate would propose re-creating
-- everything added since 0020). All statements are idempotent where Postgres
-- allows it (IF NOT EXISTS / IF EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- Sections, in dependency order:
--   A. pgvector extension (required before any vector column)
--   B. New enum: agent_project_manager_draft_status
--   C. A2 cross-project: make project_id nullable, add org_id
--   D. A6 Project Manager tables
--   E. Task dependencies table
--   F. AI reminders table
--   G. Calendar connection scope column (Phase 3)
--   H. AI findings source column (Phase 4)
--   I. Embedding columns on document_chunks, tasks, sticky_notes (Phase 4)
--   J. Public ID columns on sticky_notes, direct_conversations (nav change)
--   K. Indexes

-- ─────────────────────────────────────────────────────────────────────────────
-- A. pgvector
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- B. New enum
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "public"."agent_project_manager_draft_status" AS ENUM('draft', 'confirmed', 'applied', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- C. A2 cross-project: nullable project_id + org_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "agent_task_planner_drafts" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_task_planner_drafts"
  ADD COLUMN IF NOT EXISTS "org_id" integer
  REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "agent_task_planner_applies" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- D. A6 Project Manager tables
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_project_manager_drafts" (
  "id" varchar(80) PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "message" text NOT NULL,
  "plan_json" text NOT NULL,
  "plan_hash" varchar(64) NOT NULL,
  "status" "agent_project_manager_draft_status" DEFAULT 'draft' NOT NULL,
  "confirmation_token" text,
  "confirmed_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_project_manager_drafts"
  ADD CONSTRAINT "agent_project_manager_drafts_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_project_manager_applies" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY
    (sequence name "agent_project_manager_applies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "draft_id" varchar(80) NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "plan_hash" varchar(64) NOT NULL,
  "result_json" text NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_project_manager_applies"
  ADD CONSTRAINT "agent_project_manager_applies_draft_id_fk"
  FOREIGN KEY ("draft_id") REFERENCES "public"."agent_project_manager_drafts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "agent_project_manager_applies"
  ADD CONSTRAINT "agent_project_manager_applies_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Task dependencies
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "task_dependencies" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY
    (sequence name "task_dependencies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "blocked_task_id" integer NOT NULL,
  "blocking_task_id" integer NOT NULL,
  "created_by_id" varchar(255) NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_blocked_task_id_tasks_id_fk"
  FOREIGN KEY ("blocked_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_blocking_task_id_tasks_id_fk"
  FOREIGN KEY ("blocking_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_created_by_id_user_id_fk"
  FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- F. AI reminders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_reminders" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY
    (sequence name "ai_reminders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "user_id" varchar(255) NOT NULL,
  "text" text NOT NULL,
  "fire_at" timestamp with time zone NOT NULL,
  "source_conversation_id" varchar(80),
  "fired_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_reminders"
  ADD CONSTRAINT "ai_reminders_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Calendar connection scope (Phase 3)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "calendar_connections"
  ADD COLUMN IF NOT EXISTS "scope" varchar(512);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- H. AI findings source column (Phase 4 — pattern-based radar)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ai_findings"
  ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'deterministic' NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- I. Embedding columns (Phase 4 — semantic search)
--    vector(1536) matches the default LLM_EMBEDDING_DIMS.
--    All nullable — rows without embeddings fall back to keyword search.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
--> statement-breakpoint
ALTER TABLE "sticky_notes"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- J. Public ID columns (non-numeric URL slugs)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "sticky_notes"
  ADD COLUMN IF NOT EXISTS "public_id" varchar(21);
--> statement-breakpoint
ALTER TABLE "direct_conversations"
  ADD COLUMN IF NOT EXISTS "public_id" varchar(21);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- K. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "a6_draft_user_idx" ON "agent_project_manager_drafts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "a6_draft_status_idx" ON "agent_project_manager_drafts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "a6_draft_plan_hash_idx" ON "agent_project_manager_drafts" USING btree ("plan_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "a6_apply_draft_idx" ON "agent_project_manager_applies" USING btree ("draft_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "a6_apply_user_idx" ON "agent_project_manager_applies" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_dep_blocked_idx" ON "task_dependencies" USING btree ("blocked_task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_dep_blocking_idx" ON "task_dependencies" USING btree ("blocking_task_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_dep_unique" ON "task_dependencies" USING btree ("blocked_task_id","blocking_task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_reminder_user_idx" ON "ai_reminders" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_reminder_fire_at_idx" ON "ai_reminders" USING btree ("fire_at","fired_at");
--> statement-breakpoint
-- HNSW indexes for cosine similarity. Only effective once pgvector is installed
-- and rows have embeddings; no-op otherwise.
CREATE INDEX IF NOT EXISTS "document_chunk_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_embedding_idx"
  ON "tasks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_embedding_idx"
  ON "sticky_notes" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "note_public_id_idx" ON "sticky_notes" USING btree ("public_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_convo_public_id_idx" ON "direct_conversations" USING btree ("public_id");
