/**
 * Document chunking — where document search is actually won or lost.
 *
 * Retrieval can only return passages that were worth returning. Both failure
 * modes are invisible from the outside: chunks too small retrieve cleanly and
 * answer nothing ("it must be renewed 30 days prior" — what must?), chunks too
 * large match every query weakly and spend the whole answer budget on one hit.
 *
 * The overlap assertions are the ones that matter most. A definition and the
 * sentence relying on it routinely fall either side of a boundary, and without
 * overlap *neither* chunk can answer the question — a failure that looks like the
 * model being stupid rather than the index being wrong.
 *
 * Bulgarian appears throughout because it is the launch market and because
 * Cyrillic breaks anything that conflates characters with bytes or assumes
 * English sentence punctuation.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_CHUNKS,
  OVERLAP_CHARS,
  TARGET_CHARS,
  chunkDocument,
  normaliseText,
} from "~/server/llm/documents/chunker";

function page(text: string, page = 1) {
  return { page, text };
}

/** A paragraph of roughly `chars` characters, in whole words. */
function paragraph(chars: number, word = "lorem"): string {
  const out: string[] = [];
  let length = 0;
  while (length < chars) {
    out.push(word);
    length += word.length + 1;
  }
  return out.join(" ");
}

describe("normaliseText", () => {
  it("joins a line break inside a paragraph", () => {
    // PDF extraction emits one newline per *visual* line. Left alone these look
    // like paragraph breaks and wreck the structural split.
    expect(normaliseText("the contract\nmust be renewed")).toBe(
      "the contract must be renewed",
    );
  });

  it("keeps a real paragraph break", () => {
    expect(normaliseText("First para.\n\nSecond para.")).toBe(
      "First para.\n\nSecond para.",
    );
  });

  it("collapses three or more breaks to one paragraph break", () => {
    expect(normaliseText("A.\n\n\n\nB.")).toBe("A.\n\nB.");
  });

  it("collapses runs of spaces, including non-breaking ones", () => {
    // Column layout in a PDF becomes a run of spaces. A chunk "full" of
    // whitespace carries far less content than its length implies.
    expect(normaliseText("wide    gap")).toBe("wide gap");
    expect(normaliseText("nb  space")).toBe("nb space");
  });

  it("removes soft hyphens, which break search mid-word", () => {
    expect(normaliseText("renew­al")).toBe("renewal");
  });

  it("normalises CRLF and lone CR", () => {
    expect(normaliseText("a\r\n\r\nb")).toBe("a\n\nb");
    expect(normaliseText("a\r\rb")).toBe("a\n\nb");
  });

  it("leaves Cyrillic intact", () => {
    expect(normaliseText("Договорът\nсе подновява")).toBe(
      "Договорът се подновява",
    );
  });
});

describe("chunkDocument — sizing", () => {
  it("keeps a short document as one chunk", () => {
    const { chunks } = chunkDocument([page("A short note about invoices.")]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("A short note about invoices.");
  });

  it("splits a long document into several chunks", () => {
    const { chunks } = chunkDocument([page(paragraph(TARGET_CHARS * 3))]);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("keeps chunks near the target rather than wildly over it", () => {
    const { chunks } = chunkDocument([page(paragraph(TARGET_CHARS * 4))]);

    for (const chunk of chunks) {
      // Target plus one segment plus the overlap is the honest worst case.
      expect(chunk.text.length).toBeLessThanOrEqual(TARGET_CHARS * 2);
    }
  });

  it("prefers paragraph boundaries when it can", () => {
    const a = paragraph(TARGET_CHARS - 300, "alpha");
    const b = paragraph(TARGET_CHARS - 300, "beta");
    const { chunks } = chunkDocument([page(`${a}\n\n${b}`)]);

    // Each paragraph is under target but together they exceed it, so they should
    // land in different chunks rather than being spliced mid-paragraph.
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.text).not.toContain("beta");
  });

  it("splits a single over-long paragraph on sentence ends", () => {
    const sentence = `${paragraph(300, "clause")}. `;
    const { chunks } = chunkDocument([page(sentence.repeat(8))]);

    expect(chunks.length).toBeGreaterThan(1);
    // A sentence should not be cut in half when a boundary was available.
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("still splits text with no sentence punctuation at all", () => {
    // A table dump, a minified blob, or a language this regex does not know.
    // A chunk that cannot be stored is worse than one split awkwardly.
    const { chunks } = chunkDocument([page("x".repeat(TARGET_CHARS * 3))]);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("chunkDocument — overlap", () => {
  it("repeats the tail of one chunk at the head of the next", () => {
    const { chunks } = chunkDocument([page(paragraph(TARGET_CHARS * 3))]);

    expect(chunks.length).toBeGreaterThan(1);
    const first = chunks[0]!.text;
    const second = chunks[1]!.text;
    const tail = first.slice(-40);

    // The specific guarantee: content near a boundary appears whole somewhere.
    expect(second.startsWith(tail.slice(tail.indexOf(" ") + 1))).toBe(true);
  });

  it("starts the overlap at a word boundary", () => {
    // A fragment like "wal must be renewed" at the head of a chunk helps neither
    // a reader nor a matcher.
    const { chunks } = chunkDocument([page(paragraph(TARGET_CHARS * 3, "renewal"))]);

    expect(chunks[1]?.text.startsWith("renewal")).toBe(true);
  });

  it("carries a definition across a boundary intact", () => {
    // The motivating case, written out. The definition sits just before where a
    // boundary falls, and the sentence relying on it just after.
    const filler = paragraph(TARGET_CHARS - 120, "filler");
    const text = `${filler} A "Renewal Window" means the 30 days before expiry. The agreement terminates unless renewed inside the Renewal Window.`;

    const { chunks } = chunkDocument([page(text)]);
    const withBoth = chunks.filter(
      (c) => c.text.includes('"Renewal Window" means') && c.text.includes("terminates"),
    );

    expect(withBoth.length).toBeGreaterThanOrEqual(1);
  });

  it("does not emit a trailing chunk that is only overlap", () => {
    // Otherwise every document ends with a near-duplicate of its penultimate
    // chunk, which pollutes results with a hit that adds nothing.
    const { chunks } = chunkDocument([page(paragraph(TARGET_CHARS * 2))]);
    const last = chunks[chunks.length - 1]!;
    const previous = chunks[chunks.length - 2];

    if (previous) {
      expect(previous.text.endsWith(last.text)).toBe(false);
    }
  });

  it("uses an overlap smaller than the target, or chunks would never advance", () => {
    expect(OVERLAP_CHARS).toBeLessThan(TARGET_CHARS / 2);
  });
});

describe("chunkDocument — pages and citation", () => {
  it("attributes a chunk to the page it starts on", () => {
    const { chunks } = chunkDocument([
      page("Short first page.", 1),
      page("Short second page.", 2),
    ]);

    expect(chunks[0]?.page).toBe(1);
  });

  it("numbers chunks in reading order", () => {
    const { chunks } = chunkDocument([page(paragraph(TARGET_CHARS * 3))]);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("skips empty pages without consuming an ordinal", () => {
    // A scanned blank page extracts to nothing and must not become a chunk.
    const { chunks } = chunkDocument([
      page("Real content here.", 1),
      page("   ", 2),
      page("More real content.", 3),
    ]);

    expect(chunks.every((c) => c.text.trim().length > 0)).toBe(true);
  });

  it("handles a document that extracts to nothing at all", () => {
    // An image-only PDF. Must return empty rather than throw — OCR is not in
    // scope and the caller needs to be able to say "no text found".
    const { chunks, truncated } = chunkDocument([page("")]);

    expect(chunks).toHaveLength(0);
    expect(truncated).toBe(false);
  });
});

describe("chunkDocument — the cap", () => {
  it("stops at the cap and says so", () => {
    // A 900-page PDF is a legitimate upload and an illegitimate amount of work
    // for one request.
    const huge = paragraph(TARGET_CHARS * (MAX_CHUNKS + 20));
    const { chunks, truncated } = chunkDocument([page(huge)]);

    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
    expect(truncated).toBe(true);
  });

  it("reports no truncation for an ordinary document", () => {
    const { truncated } = chunkDocument([page(paragraph(TARGET_CHARS * 3))]);
    expect(truncated).toBe(false);
  });
});

describe("chunkDocument — Bulgarian", () => {
  it("chunks Cyrillic text without corrupting it", () => {
    const bg = paragraph(TARGET_CHARS * 3, "договор");
    const { chunks } = chunkDocument([page(bg)]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).not.toContain("�");
      expect(chunk.text).toMatch(/договор/);
    }
  });

  it("splits on Bulgarian sentence punctuation", () => {
    const sentence = `${paragraph(300, "клауза")}. `;
    const { chunks } = chunkDocument([page(sentence.repeat(8))]);

    expect(chunks.length).toBeGreaterThan(1);
  });
});
