-- Resize the embedding column on document_chunks from vector(1536) to
-- vector(1024) to match jina-embeddings-v3 (and most other free providers).
--
-- Safe to run even if rows already exist without embeddings: the column is
-- nullable, so no data is lost. If any 1536-dim embeddings were stored they
-- must be cleared first — but embeddings were never active (gated on
-- LLM_EMBEDDING_MODEL which was unset), so the column is empty in practice.
--
-- The HNSW index must be dropped and recreated: pgvector indexes are
-- dimension-specific and cannot be altered in place.

DROP INDEX IF EXISTS "document_chunk_embedding_idx";
--> statement-breakpoint

ALTER TABLE "document_chunks"
  ALTER COLUMN "embedding" TYPE vector(1024);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_chunk_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
