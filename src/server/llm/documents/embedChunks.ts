/**
 * Generate and store embeddings for document chunks that don't have one yet.
 * Called after a document finishes chunking. Failures are logged but never
 * surfaced to the user — keyword search covers the gap, and the scheduled
 * embedding sweep (~/server/llm/core/embedPending.ts) retries any chunk left
 * without a vector.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { documentChunks } from "~/server/db/schema";
import { embedTexts, serializeEmbedding } from "~/server/llm/core/embeddings";
import { createLogger } from "~/server/logger";

const log = createLogger("llm.embedChunks");

/** Inputs per embedding request; matches the sweep's batch size. */
const BATCH_SIZE = 32;

export async function embedDocumentChunks(documentId: number): Promise<void> {
  const chunks = await db
    .select({ id: documentChunks.id, content: documentChunks.content })
    .from(documentChunks)
    .where(and(eq(documentChunks.documentId, documentId), sql`"document_chunks"."embedding" IS NULL`));

  let embedded = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embedTexts(batch.map((c) => c.content), "passage");
    // Leave the rest to the sweep rather than repeat a request that just failed.
    if (!vectors) break;

    for (const [j, chunk] of batch.entries()) {
      // embedding is managed via raw migration, not in the Drizzle schema
      await db.execute(
        sql`UPDATE "document_chunks" SET "embedding" = ${serializeEmbedding(vectors[j]!)}::halfvec WHERE "id" = ${chunk.id}`,
      );
      embedded++;
    }
  }
  if (embedded) log.info("embedded document chunks", { documentId, embedded });
}
