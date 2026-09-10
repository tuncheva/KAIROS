-- pgvector, and the `embedding` columns for semantic search.
--
-- ## Why this is one migration, separate from 0041
--
-- These statements used to be sections A and I of 0041_phase1_4_features. Two
-- problems with that:
--
--  1. `CREATE EXTENSION` needs a privilege the application role may not have. On
--     a managed Postgres the role is typically not a superuser, and a failure
--     here rolled back all 37 of 0041's statements — which is why four tables
--     (task_dependencies, ai_reminders, agent_project_manager_drafts/_applies)
--     shipped with a primary key and nothing else: no foreign keys, no indexes.
--     Isolating the extension means a privilege error costs only vector search.
--
--  2. 0041 created the columns as vector(1536) and a later migration resized one
--     of the three to 1024, leaving `tasks` and `sticky_notes` mismatched against
--     the provider. Creating all three at the right width once removes the
--     resize step entirely.
--
-- ## Why 1024
--
-- jina-embeddings-v3, and most other providers with a usable free tier, emit
-- 1024 dimensions. `LLM_EMBEDDING_DIMS` defaults to 1024 to match
-- (see ~/server/llm/core/embeddings.ts). A provider with a different width needs
-- both that variable and these columns changed together — the column width is
-- not negotiable at query time, and a mismatch surfaces as a Postgres error on
-- insert rather than as degraded results.
--
-- ## Safety
--
-- Every statement is guarded. The columns are nullable, so rows without an
-- embedding simply fall back to keyword search (the FTS indexes from earlier
-- migrations carry that path). Nothing here writes data.
--
-- The HNSW indexes are dimension-specific and cannot be altered in place: a
-- future width change must drop them, alter the columns, then recreate them.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint
ALTER TABLE "sticky_notes"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint

-- HNSW with cosine distance, matching the `<=>` operator every query uses.
CREATE INDEX IF NOT EXISTS "document_chunk_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_embedding_idx"
  ON "tasks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_embedding_idx"
  ON "sticky_notes" USING hnsw ("embedding" vector_cosine_ops);
