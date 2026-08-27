/**
 * PDF text extraction utility.
 *
 * Uses Mozilla's pdfjs-dist (PDF.js) on the main thread — no workers are
 * spawned, so there are zero bundler / turbopack "expression too dynamic"
 * or "cannot find module" errors.
 *
 * Worker resolution uses `process.cwd()` which is a runtime call that
 * Turbopack cannot mangle (unlike __filename or import.meta).
 *
 * Supports documents in any language (Latin, Cyrillic, CJK, Arabic, etc.).
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Minimal types for the pdfjs-dist subset we use (avoids deep imports the
// bundler might try to follow).
// ---------------------------------------------------------------------------

interface PdfJsTextItem {
  str: string;
}

interface PdfJsTextContent {
  items: Array<PdfJsTextItem | { type: string }>;
}

interface PdfJsPage {
  getTextContent(): Promise<PdfJsTextContent>;
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  destroy(): void;
}

interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
}

interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(opts: Record<string, unknown>): PdfJsLoadingTask;
  VerbosityLevel: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum PDF file size in bytes (10 MB). */
export const MAX_PDF_SIZE = 10 * 1024 * 1024;

/** Maximum extracted text length sent to the LLM (≈ 30 000 chars ≈ 8 k tokens). */
const MAX_TEXT_LENGTH = 30_000;

/** Maximum number of pages to extract text from. */
const MAX_PAGES = 50;

/**
 * Per-call overrides.
 *
 * The defaults above are sized for the original caller, which puts extracted
 * text straight into a prompt — so its ceiling is a token budget. Document
 * ingestion has no such ceiling: the text is chunked and stored, and nothing but
 * one chunk at a time ever reaches a prompt. Capping ingestion at a prompt's
 * worth of characters would silently discard most of any real document, so the
 * limits are parameters rather than constants.
 *
 * Also returns per-page text, which the flat `text` cannot express. The chunker
 * needs it to attribute a passage to a page for citation.
 */
export interface ExtractionLimits {
  maxTextLength?: number;
  maxPages?: number;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface PdfExtractionResult {
  text: string;
  numPages: number;
  truncated: boolean;
  /** Text per page, in order. Empty pages are included as empty strings. */
  pages: Array<{ page: number; text: string }>;
}

/**
 * Extract text content from a PDF encoded as base64.
 *
 * @param base64 - The PDF file encoded as a base64 string.
 * @returns Extracted text, total page count, and whether the output was
 *          truncated (pages capped at {@link MAX_PAGES} or text at
 *          {@link MAX_TEXT_LENGTH}).
 */
export async function extractTextFromPdf(
  base64: string,
  limits: ExtractionLimits = {},
): Promise<PdfExtractionResult> {
  const maxTextLength = limits.maxTextLength ?? MAX_TEXT_LENGTH;
  const maxPages = limits.maxPages ?? MAX_PAGES;
  const buffer = Buffer.from(base64, "base64");

  // ---- Validation --------------------------------------------------------
  if (buffer.length > MAX_PDF_SIZE) {
    throw new Error(
      `PDF exceeds maximum size of ${MAX_PDF_SIZE / (1024 * 1024)}MB`,
    );
  }

  if (buffer.length < 4 || buffer.toString("ascii", 0, 4) !== "%PDF") {
    throw new Error("Invalid PDF file — file does not start with %PDF header");
  }

  // ---- Load pdfjs-dist at runtime (avoids bundler static analysis) -------
  //
  // We import the **legacy** build so it works on older Node.js runtimes and
  // does NOT try to spin up a Web Worker (or Node worker_threads).
  const pdfjsLib: PdfJsLib = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );

  // Resolve the worker using process.cwd() — this is a RUNTIME call that
  // Turbopack cannot mangle (unlike __filename or import.meta).
  // In Next.js, process.cwd() returns the project root where node_modules lives.
  const workerPath = join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    // Suppress console noise in non-browser environments
    verbosity: pdfjsLib.VerbosityLevel?.ERRORS ?? 0,
  });

  const doc = await loadingTask.promise;

  // ---- Extract text page-by-page ----------------------------------------
  try {
    const numPages = doc.numPages;
    const pagesToExtract = Math.min(numPages, maxPages);
    let fullText = "";
    let truncated = numPages > maxPages;
    const pages: Array<{ page: number; text: string }> = [];

    for (let i = 1; i <= pagesToExtract; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();

      const pageText = content.items
        .filter((item): item is PdfJsTextItem => "str" in item)
        .map((item) => item.str)
        .join(" ");

      pages.push({ page: i, text: pageText });
      fullText += pageText + "\n";

      if (fullText.length > maxTextLength) {
        fullText = fullText.slice(0, maxTextLength);
        truncated = true;
        break;
      }
    }

    fullText = fullText.trim();

    if (!fullText) {
      throw new Error(
        "No readable text found in the PDF. The file may be scanned/image-based.",
      );
    }

    return { text: fullText, numPages, truncated, pages };
  } finally {
    doc.destroy();
  }
}
