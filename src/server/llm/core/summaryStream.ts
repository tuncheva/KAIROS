/**
 * G-1 — pull the answer text out of a JSON response while it is still arriving.
 *
 * A1's contract is a single JSON object, so the obvious approaches to streaming
 * both fail: you cannot render half an object, and you cannot ask the model for
 * prose first and structure second without paying for a second call. Meanwhile
 * the tool loop can take the better part of a minute, and every second of it was
 * a spinner.
 *
 * This is the third option. The model streams its JSON as usual; this scanner
 * watches the bytes go past and emits the characters of `answer.summary` as they
 * are decoded, so the user starts reading the answer while the citations and the
 * handoff decision are still being written. Nothing about the contract changes —
 * the complete object is still parsed and validated at the end, and this is
 * strictly a view onto the same bytes.
 *
 * It is a scanner rather than an incremental JSON parser because it only needs to
 * find one field. It still has to track string state properly, though: a `details`
 * entry containing the word "summary" must not be mistaken for the key, and a
 * `\"` inside the value must not be mistaken for its end.
 */

/** Two-character JSON escapes, excluding \u which is handled separately. */
const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

type Phase =
  /** Scanning structure, looking for the key. */
  | "seeking"
  /** Key matched; waiting for the colon and the opening quote of the value. */
  | "awaiting-value"
  /** Inside the value; every decoded character is emitted. */
  | "in-value"
  /** Value finished. Nothing more will be emitted. */
  | "done";

export interface SummaryStreamOptions {
  /** The key whose string value should be streamed. Defaults to `summary`. */
  key?: string;
  /** Called with each newly decoded run of characters. */
  onDelta: (text: string) => void;
}

/**
 * Feed it content deltas; it calls `onDelta` with the answer text.
 *
 * Deliberately tolerant: a malformed or unexpected response simply produces no
 * deltas. Streaming is a progressive enhancement, and the authoritative parse
 * still happens on the complete string afterwards, so being wrong here must never
 * be worse than not streaming at all.
 */
export function createSummaryStream(options: SummaryStreamOptions) {
  const key = options.key ?? "summary";
  const quotedKey = `"${key}"`;

  let phase: Phase = "seeking";

  /** True when the scanner is inside any JSON string while seeking. */
  let inString = false;
  /** Characters of the current string literal, to compare against the key. */
  let currentString = "";
  /** Set when the previous character was a backslash. */
  let escaped = false;
  /** Collected hex digits of a \uXXXX escape. */
  let unicodeDigits: string | null = null;

  /** Emitted characters, buffered so `onDelta` is called once per chunk. */
  let pending = "";

  const flush = () => {
    if (pending) {
      options.onDelta(pending);
      pending = "";
    }
  };

  function consumeSeeking(ch: string): void {
    if (inString) {
      if (escaped) {
        escaped = false;
        currentString += ch;
        return;
      }
      if (ch === "\\") {
        escaped = true;
        return;
      }
      if (ch === '"') {
        inString = false;
        // The key is matched on the closing quote, so a partially-received
        // string can never produce a false positive.
        if (`"${currentString}"` === quotedKey) phase = "awaiting-value";
        currentString = "";
        return;
      }
      currentString += ch;
      return;
    }

    if (ch === '"') {
      inString = true;
      currentString = "";
    }
  }

  function consumeAwaitingValue(ch: string): void {
    if (ch === ":" || ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      return;
    }
    if (ch === '"') {
      phase = "in-value";
      return;
    }
    // The key was followed by something that is not a string — an object, a
    // number, `null`. Not the field being looked for; resume scanning.
    phase = "seeking";
    inString = false;
    currentString = "";
  }

  function consumeInValue(ch: string): void {
    if (unicodeDigits !== null) {
      unicodeDigits += ch;
      if (unicodeDigits.length === 4) {
        const code = Number.parseInt(unicodeDigits, 16);
        // An invalid escape is dropped rather than rendered as garbage.
        if (!Number.isNaN(code)) pending += String.fromCharCode(code);
        unicodeDigits = null;
      }
      return;
    }

    if (escaped) {
      escaped = false;
      if (ch === "u") {
        unicodeDigits = "";
        return;
      }
      pending += SIMPLE_ESCAPES[ch] ?? ch;
      return;
    }

    if (ch === "\\") {
      escaped = true;
      return;
    }

    if (ch === '"') {
      phase = "done";
      flush();
      return;
    }

    pending += ch;
  }

  return {
    /** Feed the next chunk of raw model output. */
    push(chunk: string): void {
      for (const ch of chunk) {
        // Read through a local: `phase` is reassigned by the consumers below,
        // so narrowing it across iterations would be reading a stale value.
        const current: Phase = phase;

        if (current === "done") {
          flush();
          return;
        }
        if (current === "seeking") consumeSeeking(ch);
        else if (current === "awaiting-value") consumeAwaitingValue(ch);
        else consumeInValue(ch);
      }

      // Emit once per chunk rather than once per character: an SSE frame per
      // character would cost more in framing than it delivers in text.
      flush();
    },

    /** True once the field's closing quote has been seen. */
    get complete(): boolean {
      return phase === "done";
    },

    /** Flush anything buffered — call when the stream ends mid-value. */
    end(): void {
      flush();
    },
  };
}
