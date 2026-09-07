/**
 * PDF limits shared by the browser and the server.
 *
 * The ceiling lives here rather than in `~/server/llm/pdf/pdfExtractor` because
 * both ends need it and only one of them can import that module: the extractor
 * pulls in `pdfjs-dist`, which `next.config.ts` deliberately keeps out of the
 * bundle. A client that hardcoded its own copy of the number would drift from
 * the check that actually rejects the upload.
 */

/** Maximum PDF file size in bytes (10 MB). */
export const MAX_PDF_SIZE = 10 * 1024 * 1024;

/** The same ceiling in whole megabytes, for user-facing copy. */
export const MAX_PDF_SIZE_MB = MAX_PDF_SIZE / (1024 * 1024);
