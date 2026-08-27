/**
 * Splitting a document into passages worth retrieving.
 *
 * The quality of document search is decided here, not in the retrieval step.
 * Whatever the index turns out to be — vectors or full text — it can only return
 * chunks that were worth returning, and the two ways this goes wrong are both
 * silent:
 *
 * - **Chunks too small** lose the context that makes a passage answerable. "It
 *   must be renewed 30 days prior" retrieves perfectly and means nothing.
 * - **Chunks too large** dilute the signal. A 4,000-word chunk matches every
 *   query a little and none of them well, and it spends the answer's whole token
 *   budget on one hit.
 *
 * So: split on structure where the document has any, fall back to sentences, and
 * overlap consecutive chunks so a passage that straddles a boundary is still
 * whole in one of them.
 *
 * Pure and free of database and model access, which is what makes any of the
 * above testable rather than a matter of opinion.
 */

import "server-only";

/**
 * Target chunk size, in characters rather than tokens.
 *
 * Tokens would be more accurate and would require a tokenizer for a decision
 * that only needs to be roughly right. ~1,200 characters is around 300 tokens of
 * English and rather fewer of Bulgarian — Cyrillic costs more tokens per
 * character — which is the conservative direction to be wrong in.
 */
export const TARGET_CHARS = 1_200;

/**
 * How much of the previous chunk each chunk repeats.
 *
 * The cheapest insurance in retrieval. A definition and the sentence that uses it
 * routinely fall either side of a boundary, and without overlap neither chunk
 * answers the question. 15% is enough to carry a sentence or two across.
 */
export const OVERLAP_CHARS = 180;

/** Below this, a trailing fragment is merged back rather than stored alone. */
const MIN_CHARS = 200;

/**
 * Hard ceiling on chunks per document.
 *
 * A 900-page PDF is a legitimate upload and an illegitimate amount of work to do
 * on one request. The cap is what keeps ingestion bounded; the caller reports the
 * truncation rather than hiding it.
 */
export const MAX_CHUNKS = 400;

export interface Chunk {
  /** Position in the document, 0-based. Used for ordering and citation. */
  ordinal: number;
  text: string;
  /** Page number when the extractor knew it, for citation. */
  page: number | null;
}

export interface ChunkResult {
  chunks: Chunk[];
  /** True when the document was longer than {@link MAX_CHUNKS} allows. */
  truncated: boolean;
}

/** One page of extracted text. */
export interface SourcePage {
  page: number;
  text: string;
}

/**
 * Collapse the whitespace an extractor leaves behind.
 *
 * PDF text extraction produces runs of spaces where the layout had columns, and
 * a line break per visual line rather than per paragraph. Left alone, both
 * corrupt chunk sizing — a chunk "full" of whitespace carries far less content
 * than its length suggests — and both make the stored text unpleasant to read
 * back in a citation.
 *
 * Paragraph breaks are preserved, because they are the structure the splitter
 * relies on.
 */
export function normaliseText(raw: string): string {
  return (
    raw
      // Windows and old Mac line endings, so the paragraph rule below sees one form.
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      // A single newline inside a paragraph is a layout artefact; two or more is
      // a real break. Collapse the former to a space and keep the latter.
      .replace(/([^\n])\n(?!\n)/g, "$1 ")
      .replace(/\n{3,}/g, "\n\n")
      // Runs of spaces and tabs, including the non-breaking spaces PDFs love.
      .replace(/[ \t ]{2,}/g, " ")
      // Soft hyphens, which extractors leave mid-word and which break search.
      .replaceAll("­", "")
      .trim()
  );
}

/**
 * Break text into units that should not be split further if avoidable.
 *
 * Paragraphs first. A paragraph longer than the target is then broken on sentence
 * ends — and a "sentence" that is still too long (a table row, a minified blob,
 * a language this regex does not understand) is finally broken on length, because
 * a chunk that cannot be stored is worse than one that is split awkwardly.
 */
function segments(text: string): string[] {
  const out: string[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (trimmed.length <= TARGET_CHARS) {
      out.push(trimmed);
      continue;
    }

    // Sentence ends followed by whitespace and something that starts a sentence.
    // Deliberately conservative: over-splitting here is recoverable, since the
    // packing step below rejoins.
    const sentences = trimmed.split(/(?<=[.!?…])\s+(?=[^\s])/);

    for (const sentence of sentences) {
      if (sentence.length <= TARGET_CHARS) {
        out.push(sentence);
        continue;
      }
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        out.push(sentence.slice(i, i + TARGET_CHARS));
      }
    }
  }

  return out;
}

/** The tail of a chunk, cut at a word boundary where possible. */
function tailOf(text: string, chars: number): string {
  if (text.length <= chars) return text;

  const tail = text.slice(-chars);
  const space = tail.indexOf(" ");
  // Starting mid-word would put a fragment at the head of the next chunk, which
  // helps neither reading nor matching.
  return space > 0 ? tail.slice(space + 1) : tail;
}

/**
 * Chunk a document.
 *
 * Pages are carried through so a citation can say where a passage came from. A
 * chunk that spans a page break is attributed to the page it *starts* on, which
 * is the one a reader would turn to.
 */
export function chunkDocument(pages: SourcePage[]): ChunkResult {
  const chunks: Chunk[] = [];
  let buffer = "";
  let bufferPage: number | null = null;
  let truncated = false;

  const flush = (): void => {
    const text = buffer.trim();
    if (!text) return;

    if (chunks.length >= MAX_CHUNKS) {
      truncated = true;
      return;
    }

    chunks.push({ ordinal: chunks.length, text, page: bufferPage });
    // Seed the next chunk with the tail of this one. This is the overlap, and it
    // is why a definition split across a boundary survives in one piece.
    buffer = tailOf(text, OVERLAP_CHARS);
    bufferPage = null;
  };

  for (const page of pages) {
    const normalised = normaliseText(page.text);
    if (!normalised) continue;

    for (const segment of segments(normalised)) {
      // First real content since the last flush decides the chunk's page.
      bufferPage ??= page.page;

      // `+ 1` accounts for the space joining them.
      if (buffer && buffer.length + segment.length + 1 > TARGET_CHARS) {
        flush();
        if (truncated) return { chunks, truncated };
        bufferPage ??= page.page;
      }

      buffer = buffer ? `${buffer} ${segment}` : segment;
    }
  }

  // The final buffer is whatever is left. If it is only the overlap carried from
  // the previous chunk there is no new content in it, so it is dropped rather
  // than stored as a near-duplicate.
  const remaining = buffer.trim();
  const lastText = chunks[chunks.length - 1]?.text ?? "";
  const isOnlyOverlap = Boolean(lastText) && lastText.endsWith(remaining);

  if (remaining && !isOnlyOverlap) {
    if (remaining.length < MIN_CHARS && chunks.length) {
      // Too small to retrieve usefully on its own — a heading or a page number.
      // Appended to the previous chunk instead of stored as a fragment.
      const last = chunks[chunks.length - 1]!;
      last.text = `${last.text} ${remaining}`;
    } else {
      flush();
    }
  }

  return { chunks, truncated };
}
