-- Resize the `embedding` columns to halfvec(2048) for nvidia/nemotron-3-embed-1b.
--
-- ## Why this model
--
-- It is on the same free NVIDIA endpoint and key the chat models already use, so
-- semantic search adds no provider and no bill. Probed on Bulgarian task- and
-- note-style text, it ranked the right passage first for 7 of 7 queries
-- (llama-nemotron-embed-vl-1b-v2: 6 of 7; the 1024-wide models the 0044 comment
-- anticipated — bge-m3, nv-embedqa-e5-v5 — reached end of life on 2026-08-25).
-- It emits 2048 dimensions and nothing else: `dimensions: 1024` is rejected.
--
-- ## Why halfvec
--
-- pgvector's HNSW index caps `vector` at 2000 dimensions; `halfvec` (pgvector
-- 0.7+, the database runs 0.8.0) allows 4000. Half precision costs nothing
-- measurable for cosine ranking and halves the storage.
--
-- ## Safety
--
-- When this was written every `embedding` value was NULL — no provider had ever
-- been configured — so the `USING NULL` conversion discards nothing. On a
-- database that does hold vectors, they are from a different model and would be
-- incomparable with new ones anyway; the sweep re-embeds every NULL row.
--
-- The HNSW indexes are dimension-specific, so they are dropped and rebuilt.

DROP INDEX IF EXISTS "document_chunk_embedding_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "task_embedding_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "note_embedding_idx";
--> statement-breakpoint

ALTER TABLE "document_chunks"
  ALTER COLUMN "embedding" TYPE halfvec(2048) USING NULL;
--> statement-breakpoint
ALTER TABLE "tasks"
  ALTER COLUMN "embedding" TYPE halfvec(2048) USING NULL;
--> statement-breakpoint
ALTER TABLE "sticky_notes"
  ALTER COLUMN "embedding" TYPE halfvec(2048) USING NULL;
--> statement-breakpoint

-- HNSW with cosine distance, matching the `<=>` operator every query uses.
CREATE INDEX IF NOT EXISTS "document_chunk_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" halfvec_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_embedding_idx"
  ON "tasks" USING hnsw ("embedding" halfvec_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_embedding_idx"
  ON "sticky_notes" USING hnsw ("embedding" halfvec_cosine_ops);
