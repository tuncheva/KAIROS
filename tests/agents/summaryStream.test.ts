/**
 * G-1 — the incremental answer scanner.
 *
 * Worth real tests because it runs on every chat turn, sees adversarial input by
 * construction (the model writes it), and fails in the most visible place there
 * is: the text the user reads. The cases below are the ones that would produce
 * plausible-looking wrong output rather than an obvious crash.
 */

import { describe, expect, it } from "vitest";

import { createSummaryStream } from "~/server/llm/core/summaryStream";

/** Feed a whole string as one chunk and return what was emitted. */
function scan(json: string): string {
  let out = "";
  const stream = createSummaryStream({ onDelta: (text) => (out += text) });
  stream.push(json);
  stream.end();
  return out;
}

/** Feed one character at a time — the shape a real stream actually arrives in. */
function scanCharwise(json: string): string {
  let out = "";
  const stream = createSummaryStream({ onDelta: (text) => (out += text) });
  for (const ch of json) stream.push(ch);
  stream.end();
  return out;
}

describe("summary stream", () => {
  it("extracts the summary from a complete object", () => {
    const json = JSON.stringify({
      intent: { type: "answer" },
      answer: { summary: "Project Alpha is 62% complete." },
    });
    expect(scan(json)).toBe("Project Alpha is 62% complete.");
  });

  it("produces the same result whatever the chunk boundaries are", () => {
    // The real failure mode: a chunk boundary landing inside the key, inside an
    // escape sequence, or between the key and its colon.
    const json = JSON.stringify({
      answer: { summary: 'She said "hello" — then left.\nNew line.' },
    });
    expect(scanCharwise(json)).toBe(scan(json));
    expect(scanCharwise(json)).toBe('She said "hello" — then left.\nNew line.');
  });

  it("decodes escapes rather than emitting them raw", () => {
    const json = '{"answer":{"summary":"Line one\\nLine two\\tTabbed \\"quoted\\" back\\\\slash"}}';
    expect(scan(json)).toBe('Line one\nLine two\tTabbed "quoted" back\\slash');
  });

  it("decodes \\u escapes, including non-Latin text", () => {
    const json = '{"answer":{"summary":"\\u0417\\u0430\\u0434\\u0430\\u0447\\u0430"}}';
    // Bulgarian is the second-largest locale, and a provider that escapes
    // non-ASCII would otherwise stream visible garbage to exactly those users.
    expect(scan(json)).toBe("Задача");
  });

  it("does not mistake the word summary inside another string for the key", () => {
    const json = JSON.stringify({
      answer: {
        details: ['This is a summary: of things', 'Another "summary" mention'],
        summary: "The real answer.",
      },
    });
    expect(scan(json)).toBe("The real answer.");
  });

  it("does not match a key that merely contains summary", () => {
    const json = '{"summaryOfSummaries":"wrong","answer":{"summary":"right"}}';
    expect(scan(json)).toBe("right");
  });

  it("stops at the closing quote and ignores everything after", () => {
    const json = JSON.stringify({
      answer: { summary: "Done." },
      citations: [{ label: "summary", ref: "task:1" }],
      followUps: ["What else?"],
    });
    expect(scan(json)).toBe("Done.");
  });

  it("emits nothing for a handoff, which has no answer at all", () => {
    const json = JSON.stringify({
      intent: { type: "handoff" },
      handoffs: [{ targetAgent: "task_planner", context: {}, userIntent: "x" }],
    });
    expect(scan(json)).toBe("");
  });

  it("emits what it has when the stream is cut mid-value", () => {
    // A dropped connection must still leave the user with the partial answer
    // they were already reading, not blank it.
    const partial = '{"answer":{"summary":"Half a sen';
    expect(scan(partial)).toBe("Half a sen");
  });

  it("emits nothing for malformed input rather than throwing", () => {
    // Streaming is a progressive enhancement; the authoritative parse happens on
    // the complete string afterwards. Being wrong here must never be worse than
    // not streaming at all.
    expect(() => scan("not json at all")).not.toThrow();
    expect(scan("not json at all")).toBe("");
    expect(scan("")).toBe("");
    expect(scan("{{{{")).toBe("");
  });

  it("skips a summary key whose value is not a string", () => {
    const json = '{"summary":null,"answer":{"summary":"the string one"}}';
    expect(scan(json)).toBe("the string one");
  });

  it("reports completion once the value is closed", () => {
    const stream = createSummaryStream({ onDelta: () => undefined });
    stream.push('{"answer":{"summary":"x');
    expect(stream.complete).toBe(false);
    stream.push('"}}');
    expect(stream.complete).toBe(true);
  });

  it("batches a chunk into a single delta call", () => {
    // One SSE frame per character would cost more in framing than it delivers.
    const calls: string[] = [];
    const stream = createSummaryStream({ onDelta: (t) => calls.push(t) });
    stream.push('{"answer":{"summary":"abcdef"}}');
    expect(calls).toEqual(["abcdef"]);
  });
});
