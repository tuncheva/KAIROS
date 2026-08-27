/**
 * Turning an uploaded file into searchable passages.
 *
 * The pipeline is: fetch the bytes, extract text, chunk, store. Each step can
 * fail in a way the user needs to understand, so the document row carries a
 * status rather than the operation throwing into a void — a file that silently
 * never becomes searchable is the worst version of this feature.
 *
 * Three outcomes, deliberately distinguished:
 *
 * - `ready` — text extracted and chunked.
 * - `no_text` — the file parsed fine and contains no text layer. A scan. Not
 *   broken, and telling the user "failed" would send them to support instead of
 *   to a different file. OCR is out of scope and saying so is more useful than
 *   implying it might work next time.
 * - `failed` — something actually went wrong: unreachable storage, a corrupt
 *   file, an unsupported type.
 */

import "server-only";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { documentChunks, documents } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { extractTextFromPdf } from "~/server/llm/pdf/pdfExtractor";

import { MAX_CHUNKS, chunkDocument, type SourcePage } from "./chunker";

const log = createLogger("llm.documents");

/**
 * Largest file this will fetch and parse.
 *
 * Above the extractor's own prompt-oriented default, because a stored-and-chunked
 * document has no prompt budget to respect — but still bounded, since the whole
 * file is held in memory to parse it.
 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * Text ceiling for ingestion.
 *
 * Generous relative to the extractor's 30k default, which exists because its
 * original caller puts the text straight into a prompt. Here nothing but one
 * chunk at a time ever reaches a model, so the real limit is
 * {@link MAX_CHUNKS} — this is only a guard against pathological files.
 */
const MAX_INGEST_CHARS = MAX_CHUNKS * 2_000;

/** Pages this will read. Well past any document someone uploads to ask about. */
const MAX_INGEST_PAGES = 500;

export type DocumentStatus = "pending" | "ready" | "failed" | "no_text";

export interface IngestResult {
  status: DocumentStatus;
  chunkCount: number;
  pageCount: number | null;
  truncated: boolean;
  error: string | null;
}

/** What this can parse. Anything else is refused at registration. */
export function isSupportedDocumentType(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("text/");
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Storage returned ${String(response.status)}`);
  }

  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_DOCUMENT_BYTES) {
    throw new Error("File is too large to index");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // Checked again after the fact: `content-length` is a claim, not a guarantee,
  // and a chunked response carries no length at all.
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error("File is too large to index");
  }

  return buffer;
}

async function pagesFrom(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ pages: SourcePage[]; pageCount: number | null; truncated: boolean }> {
  if (input.mimeType === "application/pdf") {
    const extracted = await extractTextFromPdf(input.buffer.toString("base64"), {
      maxTextLength: MAX_INGEST_CHARS,
      maxPages: MAX_INGEST_PAGES,
    });

    return {
      pages: extracted.pages,
      pageCount: extracted.numPages,
      truncated: extracted.truncated,
    };
  }

  // Plain text has no pages. One synthetic page keeps the chunker's interface
  // uniform, and `page: 1` is honest for a single-page document.
  const text = input.buffer.toString("utf8").slice(0, MAX_INGEST_CHARS);
  return {
    pages: [{ page: 1, text }],
    pageCount: null,
    truncated: input.buffer.length > MAX_INGEST_CHARS,
  };
}

/**
 * Ingest one already-registered document.
 *
 * Never throws. Every failure is recorded on the row, because the caller is
 * either a fire-and-forget upload callback or a retry, and neither has anywhere
 * useful to put an exception.
 */
export async function ingestDocument(documentId: number): Promise<IngestResult> {
  const [doc] = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      storageKey: documents.storageKey,
      mimeType: documents.mimeType,
      filename: documents.filename,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return {
      status: "failed",
      chunkCount: 0,
      pageCount: null,
      truncated: false,
      error: "Document not found",
    };
  }

  const finish = async (result: IngestResult): Promise<IngestResult> => {
    await db
      .update(documents)
      .set({
        status: result.status,
        chunkCount: result.chunkCount,
        pageCount: result.pageCount,
        truncated: result.truncated,
        error: result.error,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    return result;
  };

  try {
    const buffer = await fetchBytes(doc.storageKey);
    const { pages, pageCount, truncated } = await pagesFrom({
      buffer,
      mimeType: doc.mimeType,
    });

    const { chunks, truncated: chunkTruncated } = chunkDocument(pages);

    if (!chunks.length) {
      return finish({
        status: "no_text",
        chunkCount: 0,
        pageCount,
        truncated: false,
        error:
          "No text found in this file. If it is a scan, it needs to be OCR'd before it can be searched.",
      });
    }

    // Replace rather than append, so a re-ingest is idempotent instead of
    // doubling every passage.
    await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));

    await db.insert(documentChunks).values(
      chunks.map((chunk) => ({
        documentId,
        userId: doc.userId,
        ordinal: chunk.ordinal,
        content: chunk.text,
        page: chunk.page,
      })),
    );

    log.info("document ingested", {
      documentId,
      chunks: chunks.length,
      pageCount,
    });

    return finish({
      status: "ready",
      chunkCount: chunks.length,
      pageCount,
      truncated: truncated || chunkTruncated,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message.slice(0, 500) : "Indexing failed";

    log.warn("document ingest failed", { documentId, err });

    // A PDF with no text layer throws from the extractor rather than returning
    // empty, so the honest outcome is decided on the message rather than on the
    // exception type.
    const noText = /no readable text/i.test(message);

    return finish({
      status: noText ? "no_text" : "failed",
      chunkCount: 0,
      pageCount: null,
      truncated: false,
      error: noText
        ? "No text found in this file. If it is a scan, it needs to be OCR'd before it can be searched."
        : message,
    });
  }
}
