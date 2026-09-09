/**
 * Generate and store embeddings for document chunks that don't have one yet.
 * Called after a document finishes chunking. Failures are logged but never
 * surfaced to the user — keyword search is the fallback.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { documentChunks } from "~/server/db/schema";
import { embedText } from "~/server/llm/core/embeddings";
import { createLogger } from "~/server/logger";

const log = createLogger("llm.embedChunks");

export async function embedDocumentChunks(documentId: number): Promise<void> {
  const chunks = await db
    .select({ id: documentChunks.id, content: documentChunks.content })
    .from(documentChunks)
    .where(and(eq(documentChunks.documentId, documentId), sql`"document_chunks"."embedding" IS NULL`));

  let embedded = 0;
  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content);
    if (!embedding) continue;
    // embedding is managed via raw migration, not in the Drizzle schema
    await db.execute(
      sql`UPDATE "document_chunks" SET "embedding" = ${`[${embedding.join(",")}]`}::vector WHERE "id" = ${chunk.id}`,
    );
    embedded++;
  }
  if (embedded) log.info("embedded document chunks", { documentId, embedded });
}
