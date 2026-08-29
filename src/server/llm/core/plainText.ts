/**
 * Markdown stripping for model output that the client renders as plain text.
 *
 * ## Why
 *
 * The agents return JSON, and the client renders the strings inside it
 * literally — `answer.summary` goes into a paragraph, each `answer.details`
 * entry becomes a bullet the client draws the glyph for. Nothing in that path
 * parses Markdown. So when the model writes `**Component Systems Night**` the
 * user reads the asterisks, and when it starts a detail with `- ` the row shows
 * two bullets.
 *
 * Every prompt already says to keep formatting out of the JSON strings, and
 * several of them said it twice. It does not hold: the model is writing prose
 * for a human, emphasis is what prose for a human looks like, and the same
 * instruction has to survive a tool loop, a JSON contract and several thousand
 * tokens of workspace data. Asking harder is not a fix — this is a rendering
 * concern, and it belongs on the rendering side of the boundary.
 *
 * ## What this does not do
 *
 * It does not touch stored long-form content — note bodies, task descriptions —
 * where the user may well have asked for structure and will edit it later in an
 * editor that understands it. Only the strings the chat renders verbatim are
 * sanitized; see the `plainString` uses in the agent schemas.
 */

import { z } from "zod";

/** ```fenced``` blocks — the fence goes, the code inside stays. */
const FENCE = /```[a-z0-9-]*\n?([\s\S]*?)```/gi;

/** `inline code` — backticks around a single line. */
const INLINE_CODE = /`([^`\n]+)`/g;

/** [label](https://example.com) and ![alt](src) — the label survives. */
const LINK = /!?\[([^\]\n]*)\]\(([^)\n]*)\)/g;

/** **bold**, __bold__, *italic*, _italic_, ~~strike~~. */
const BOLD = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
const ITALIC_STAR = /(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g;
/**
 * `_italic_` only between non-word characters.
 *
 * Without that guard this eats the underscores out of `project_id` and
 * `created_at`, which the model does quote when it is reading a tool result
 * back to the user.
 */
const ITALIC_UNDERSCORE = /(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g;
const STRIKE = /~~(?=\S)([\s\S]*?\S)~~/g;

/** ## Heading, > quote, --- rule, and leading list markers. */
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const QUOTE = /^[ \t]{0,3}>[ \t]?/gm;
const RULE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;
/**
 * A leading bullet on a line.
 *
 * The client draws its own glyph for every `details` entry, so a model-written
 * one renders as a doubled bullet. `•` is in here because the prompts ban it by
 * name and it still shows up.
 */
const LIST_MARKER = /^[ \t]*(?:[-*+•‣▪]|\d{1,3}[.)])[ \t]+/gm;

/** Whitespace left behind once the markup is gone. */
const TRAILING_SPACE = /[ \t]+$/gm;
const REPEATED_BLANK_LINES = /\n{3,}/g;

/**
 * The same text with its Markdown markup removed.
 *
 * Idempotent and lossless as to words: every character that was content stays,
 * only the markup around it goes. Applied twice — once by the schema, once by a
 * caller that does not know that — it produces the same string.
 */
export function toPlainText(text: string): string {
  return text
    .replace(FENCE, "$1")
    .replace(INLINE_CODE, "$1")
    .replace(LINK, "$1")
    .replace(BOLD, "$2")
    .replace(STRIKE, "$1")
    .replace(ITALIC_STAR, "$1")
    .replace(ITALIC_UNDERSCORE, "$1")
    .replace(RULE, "")
    .replace(HEADING, "")
    .replace(QUOTE, "")
    .replace(LIST_MARKER, "")
    .replace(TRAILING_SPACE, "")
    .replace(REPEATED_BLANK_LINES, "\n\n")
    .trim();
}

/**
 * A string field that is stripped of Markdown before it is validated.
 *
 * Preprocessed rather than transformed so `min`/`max` apply to what the user
 * will actually see: `"**"` is an empty string once the markup is gone, and a
 * 120-character cap on a followUp should be counting words, not asterisks.
 *
 * ```ts
 * summary: plainString(z.string().min(1))
 * ```
 */
export function plainString<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" ? toPlainText(value) : value),
    schema,
  );
}

/**
 * Markup that may still be waiting for its closing half.
 *
 * `**bold` is not bold until the second `**` arrives, so a streaming filter that
 * cleaned only what it had would emit the asterisks and then have no way to take
 * them back. Each entry is a delimiter whose occurrences must be even for the
 * text to be closed; an odd count means the last one is an opener and everything
 * from it onward has to wait.
 */
const PAIRED = ["```", "**", "~~", "*", "`", "_"] as const;

/** A line that so far contains only what could become a list marker or heading. */
const PARTIAL_MARKER = /\n[ \t]*[-*+#>\d.)•‣▪]*$/;

/**
 * The longest prefix of `raw` whose Markdown meaning is already settled.
 *
 * Everything after the cut is text that could still turn out to be markup — an
 * unclosed emphasis run, a half-typed link, a line that is so far only a dash.
 */
function stablePrefix(raw: string): string {
  let cut = raw.length;

  for (const delimiter of PAIRED) {
    // Count from the start each time: `**` is counted before `*`, and the loop
    // below skips the positions `**` already claimed.
    const positions: number[] = [];
    for (let i = 0; i < raw.length; ) {
      const found = raw.indexOf(delimiter, i);
      if (found === -1) break;
      positions.push(found);
      i = found + delimiter.length;
    }
    if (positions.length % 2 === 1) {
      cut = Math.min(cut, positions[positions.length - 1]!);
    }
  }

  // A link is unclosed while there is a `[` with no `)` after it.
  const openBracket = raw.lastIndexOf("[");
  if (openBracket !== -1 && !raw.includes(")", openBracket)) {
    cut = Math.min(cut, openBracket);
  }

  const partial = PARTIAL_MARKER.exec(raw.slice(0, cut));
  if (partial) cut = Math.min(cut, partial.index);

  return raw.slice(0, cut);
}

/**
 * A streaming wrapper around {@link toPlainText}.
 *
 * The answer is streamed to the client character by character while the model
 * writes it, so cleaning the final object is not enough on its own — the user
 * would watch `**Component Systems Night**` type itself out and then change.
 * This filter holds back any tail that could still become markup and releases it
 * once the question is settled, so what reaches the client is only ever plain
 * text it will not have to un-render.
 *
 * `end()` flushes whatever was still being withheld — an unclosed `**` at the
 * end of a truncated response is just text, and the user should see it.
 */
export function createPlainTextFilter(onDelta: (text: string) => void) {
  let raw = "";
  let emitted = "";

  const release = (clean: string) => {
    if (!clean.startsWith(emitted)) {
      // Stripping markup can shorten text the filter has already released — a
      // closing `**` arriving late turns `**bold` into `bold`. Nothing can
      // un-send those characters, so the filter keeps going from where it is
      // rather than repeating or reordering what the user has already read.
      emitted = clean.slice(0, emitted.length);
      return;
    }
    const delta = clean.slice(emitted.length);
    if (!delta) return;
    emitted = clean;
    onDelta(delta);
  };

  return {
    push(text: string) {
      raw += text;
      // `trimEnd` is not applied here: `toPlainText` trims, and trimming a
      // prefix would swallow the space between two words that arrive in
      // separate deltas.
      release(toPlainText(stablePrefix(raw)));
    },
    end() {
      release(toPlainText(raw));
    },
  };
}
