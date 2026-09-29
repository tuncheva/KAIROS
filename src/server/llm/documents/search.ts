/**
 * `searchDocuments` — the agent's read tool over uploaded documents.
 *
 * **This function is the vector seam.** Everything else about documents — upload,
 * extraction, chunking, storage, the tool definition the model sees, the citation
 * shape — is unchanged by how retrieval works. Adding embeddings means adding a
 * column, a second index and a branch here; it means touching nothing else. That
 * is why full text was a defensible first step rather than a shortcut to regret.
 *
 * What full text costs, stated plainly so nobody has to discover it: it matches
 * words. "How do I cancel" will not find "termination clause". With an embedding
 * provider configured (`LLM_EMBEDDING_MODEL`), a vector arm runs alongside and
 * the two rankings are fused; without one, search is keyword-only and the tool
 * description tells the model so.
 *
 * Scope is the other half. A chunk is visible if the caller owns the document, or
 * if the document is attached to a project the caller can see — the same
 * `visibleProjectsWhere` predicate the rest of the agent layer uses, so documents
 * do not become the one place org scoping is reimplemented slightly differently.
 */

import "server-only";

import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { documentChunks, documents, projects } from "~/server/db/schema";
import {
  loadVisibleScope,
  requireUser,
  visibleProjectsWhere,
} from "~/server/llm/tools/a1/scope";
import type { A1Tool } from "~/server/llm/tools/a1/types";
import {
  embedText,
  isEmbeddingConfigured,
  serializeEmbedding,
} from "~/server/llm/core/embeddings";
import { fuseRankings } from "~/server/llm/core/rankFusion";

/** Passages returned per query. Enough to answer, few enough to read. */
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

/** Characters of each passage handed to the model. */
const SNIPPET_CHARS = 700;

export interface DocumentHit {
  documentId: number;
  filename: string;
  /** Page the passage starts on, when known — the citation. */
  page: number | null;
  ordinal: number;
  snippet: string;
}

export interface SearchDocumentsInput {
  query: string;
  limit?: number;
}

export interface SearchDocumentsOutput {
  hits: DocumentHit[];
  /**
   * Said out loud to the model, because it changes how an empty result should be
   * reported. "Nothing matched those words" is a different answer from "you have
   * no documents", and only one of them should prompt rephrasing.
   */
  note: string;
}

export async function searchDocuments(
  ctx: TRPCContext,
  input: SearchDocumentsInput,
): Promise<SearchDocumentsOutput> {
  const userId = requireUser(ctx);
  const query = input.query.trim();

  if (query.length < 2) {
    return { hits: [], note: "The query was too short to search." };
  }

  const scope = await loadVisibleScope(ctx, userId);
  const visible = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(visibleProjectsWhere(scope));
  const projectIds = visible.map((p) => p.id);

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // A chunk is visible if the caller owns its document, or if the document is
  // attached to a project they can see. `isNull` is excluded on purpose: an
  // unscoped document belongs to its owner alone, and treating null as
  // "everyone" would leak every personal upload.
  const visibleChunk = and(
    // Only documents that finished indexing. A `pending` row has no chunks,
    // but a `failed` one may have stale chunks from an earlier attempt.
    eq(documents.status, "ready"),
    or(
      eq(documents.userId, userId),
      projectIds.length
        ? and(
            inArray(documents.projectId, projectIds),
            sql`${documents.projectId} IS NOT NULL`,
          )
        : sql`false`,
    ),
  );

  const chunkColumns = {
    id: documentChunks.id,
    documentId: documentChunks.documentId,
    filename: documents.filename,
    page: documentChunks.page,
    ordinal: documentChunks.ordinal,
    content: documentChunks.content,
  };

  const queryEmbedding = await embedText(query, "query");
  const embeddingLiteral = queryEmbedding ? serializeEmbedding(queryEmbedding) : null;

  // Both arms run and are fused (see ~/server/llm/core/rankFusion.ts): chunks
  // still waiting for an embedding stay findable by their words, and a literal
  // term — a clause number, an invoice id — still finds the passage containing it.
  const [vectorRows, keywordRows] = await Promise.all([
    embeddingLiteral
      ? ctx.db
          .select(chunkColumns)
          .from(documentChunks)
          .innerJoin(documents, eq(documentChunks.documentId, documents.id))
          .where(and(visibleChunk, sql`"document_chunks"."embedding" IS NOT NULL`))
          .orderBy(sql`"document_chunks"."embedding" <=> ${embeddingLiteral}::halfvec`)
          .limit(limit)
      : Promise.resolve([]),
    ctx.db
      .select(chunkColumns)
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(
        and(
          visibleChunk,
          sql`to_tsvector('simple', ${documentChunks.content}) @@ plainto_tsquery('simple', ${query})`,
        ),
      )
      .orderBy(
        // `ts_rank_cd` weights by how close the matched terms are to each other,
        // which is a better proxy for "this passage is about the query" than plain
        // term frequency.
        desc(
          sql`ts_rank_cd(to_tsvector('simple', ${documentChunks.content}), plainto_tsquery('simple', ${query}))`,
        ),
      )
      .limit(limit),
  ]);

  const rows = fuseRankings([keywordRows, vectorRows], (r) => r.id, limit);

  if (!rows.length) {
    // Distinguishing "no documents" from "no match" is what stops the model
    // telling a user to rephrase when the real problem is an empty library.
    const [{ count } = { count: 0 }] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.status, "ready")));

    return {
      hits: [],
      note:
        count === 0
          ? "This user has no indexed documents. Say so rather than suggesting different wording."
          : isEmbeddingConfigured()
            ? "No passage matched. Suggest the user describe what they are looking for differently."
            : "No passage matched those words. Search matches wording, not meaning, so suggest the user try the terms the document itself would use.",
    };
  }

  return {
    hits: rows.map((r) => ({
      documentId: r.documentId,
      filename: r.filename,
      page: r.page,
      ordinal: r.ordinal,
      snippet: r.content.slice(0, SNIPPET_CHARS),
    })),
    note: "Cite the filename, and the page where one is given.",
  };
}

export const searchDocumentsTool: A1Tool<
  "searchDocuments",
  SearchDocumentsInput,
  SearchDocumentsOutput
> = {
  name: "searchDocuments",
  // `describe` is resolved through a getter rather than inline, because
  // `isEmbeddingConfigured()` reads the validated server env. Called while this
  // module's top-level bindings are being initialised it ran at *import* time,
  // so merely importing the A1 tool registry required a server environment —
  // which broke every client-side and test consumer of the registry — and froze
  // the wording at process start. Now it is read the first time the schema is
  // actually built.
  get inputSchema() {
    return z
      .object({
        query: z
          .string()
          .min(2)
          .max(200)
          .describe(
            isEmbeddingConfigured()
              ? "Describe what you are looking for in your own words — the query is matched semantically, so natural phrasing works better than exact keywords."
              : "Words likely to appear in the document. This is a keyword search, not a semantic one, so use the terms the document itself would use.",
          ),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      })
      .strict();
  },
  outputSchema: z.custom<SearchDocumentsOutput>(),

  async execute(ctx, input) {
    return searchDocuments(ctx, input);
  },
};
