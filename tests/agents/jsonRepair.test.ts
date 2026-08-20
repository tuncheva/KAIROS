import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("~/env", () => ({
  env: {
    LLM_BASE_URL: "https://llm.test/api/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "primary-model",
    AUTH_SECRET: "x".repeat(32),
  },
}));

const chatCompletion = vi.fn();
const simpleCompletion = vi.fn();

/** The real error class, so `instanceof` checks in the module under test hold. */
class TruncatedResponseError extends Error {
  readonly partialContent: string;
  readonly maxTokens: number;
  constructor(partialContent: string, maxTokens: number) {
    super("truncated");
    this.name = "TruncatedResponseError";
    this.partialContent = partialContent;
    this.maxTokens = maxTokens;
  }
}

vi.mock("~/server/llm/core/modelClient", () => ({
  chatCompletion,
  simpleCompletion,
  TruncatedResponseError,
}));

const recordExtraAiCall = vi.fn();
vi.mock("~/server/security/rateLimit", () => ({ recordExtraAiCall }));

const { extractJson, parseAndValidate, completeJson } = await import(
  "~/server/llm/core/jsonRepair"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractJson", () => {
  it("returns a bare object unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("unwraps a markdown fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("drops commentary around the object", () => {
    expect(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.')).toBe(
      '{"a":1}',
    );
  });

  it("handles arrays", () => {
    expect(extractJson("prefix [1,2,3] suffix")).toBe("[1,2,3]");
  });

  it("handles nesting", () => {
    const nested = '{"a":{"b":[{"c":1}]}}';
    expect(extractJson(`text ${nested} text`)).toBe(nested);
  });

  /**
   * The scan used to count braces without tracking string state, so a `{` inside
   * any string value — a task description, a note body — closed the object early
   * and produced a slice that could never parse.
   */
  it("ignores braces inside string values", () => {
    const json = '{"title":"Refactor {config} loader","done":true}';
    expect(extractJson(json)).toBe(json);
    expect(JSON.parse(extractJson(json))).toEqual({
      title: "Refactor {config} loader",
      done: true,
    });
  });

  it("ignores escaped quotes when tracking strings", () => {
    const json = '{"note":"she said \\"hi\\" and left {ok}"}';
    expect(JSON.parse(extractJson(json))).toEqual({
      note: 'she said "hi" and left {ok}',
    });
  });

  it("returns the tail when the JSON is unbalanced", () => {
    expect(extractJson('prefix {"a":1')).toBe('{"a":1');
  });

  it("returns the input when there is no JSON at all", () => {
    expect(extractJson("  no json here  ")).toBe("no json here");
  });
});

const Schema = z.object({ name: z.string(), count: z.number() });

describe("parseAndValidate", () => {
  it("validates well-formed output without a repair call", async () => {
    const result = await parseAndValidate('{"name":"a","count":1}', Schema);

    expect(result).toEqual({
      success: true,
      data: { name: "a", count: 1 },
      repairCount: 0,
    });
    expect(simpleCompletion).not.toHaveBeenCalled();
  });

  it("repairs malformed JSON and reports the repair", async () => {
    simpleCompletion.mockResolvedValueOnce('{"name":"a","count":1}');

    const result = await parseAndValidate("{name: 'a', count: 1}", Schema);

    expect(result).toMatchObject({ success: true, repairCount: 1 });
    expect(simpleCompletion).toHaveBeenCalledTimes(1);
  });

  it("repairs output that parses but violates the schema", async () => {
    simpleCompletion.mockResolvedValueOnce('{"name":"a","count":2}');

    const result = await parseAndValidate('{"name":"a","count":"two"}', Schema);
    expect(result).toMatchObject({ success: true, repairCount: 1 });
  });

  it("gives up after two repairs", async () => {
    simpleCompletion.mockResolvedValue("still not json");

    const result = await parseAndValidate("nope", Schema);

    expect(result.success).toBe(false);
    expect(result.repairCount).toBe(2);
    expect(simpleCompletion).toHaveBeenCalledTimes(2);
  });

  /**
   * Repairs were invisible to the limiter, so one chat message could cost three
   * completions against a budget that only counted one.
   */
  it("bills repair calls to the caller's AI budget", async () => {
    simpleCompletion.mockResolvedValueOnce('{"name":"a","count":1}');

    await parseAndValidate("bad", Schema, { userId: "user-1" });

    expect(recordExtraAiCall).toHaveBeenCalledWith("user-1");
  });

  it("fails cleanly when the repair call itself throws", async () => {
    simpleCompletion.mockRejectedValueOnce(new Error("upstream down"));

    const result = await parseAndValidate("bad", Schema);
    expect(result).toMatchObject({ success: false, error: "Repair prompt failed" });
  });
});

describe("completeJson", () => {
  it("returns validated data from a single call", async () => {
    chatCompletion.mockResolvedValueOnce({ content: '{"name":"a","count":1}' });

    const result = await completeJson({
      messages: [{ role: "user", content: "go" }],
      schema: Schema,
    });

    expect(result).toMatchObject({ success: true, data: { name: "a", count: 1 } });
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("asks for JSON mode", async () => {
    chatCompletion.mockResolvedValueOnce({ content: '{"name":"a","count":1}' });

    await completeJson({
      messages: [{ role: "user", content: "go" }],
      schema: Schema,
    });

    expect(chatCompletion.mock.calls[0]![0]).toMatchObject({ jsonMode: true });
  });

  /**
   * Truncation is retried with a bigger budget, never repaired: the output is
   * incomplete rather than malformed, and a repair prompt would invent the rest.
   */
  it("retries a truncated response with a doubled budget", async () => {
    chatCompletion
      .mockRejectedValueOnce(new TruncatedResponseError("", 4096))
      .mockResolvedValueOnce({ content: '{"name":"a","count":1}' });

    const result = await completeJson({
      messages: [{ role: "user", content: "go" }],
      schema: Schema,
      maxTokens: 4096,
    });

    expect(result).toMatchObject({ success: true });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(chatCompletion.mock.calls[1]![0]).toMatchObject({ maxTokens: 8192 });
    expect(simpleCompletion).not.toHaveBeenCalled();
  });

  it("caps the retry budget", async () => {
    chatCompletion
      .mockRejectedValueOnce(new TruncatedResponseError("", 12_000))
      .mockResolvedValueOnce({ content: '{"name":"a","count":1}' });

    await completeJson({
      messages: [{ role: "user", content: "go" }],
      schema: Schema,
      maxTokens: 12_000,
    });

    expect(chatCompletion.mock.calls[1]![0]).toMatchObject({ maxTokens: 16_384 });
  });

  it("gives up after a second truncation rather than looping", async () => {
    chatCompletion.mockRejectedValue(new TruncatedResponseError("", 4096));

    await expect(
      completeJson({
        messages: [{ role: "user", content: "go" }],
        schema: Schema,
      }),
    ).rejects.toBeInstanceOf(TruncatedResponseError);

    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it("propagates non-truncation errors without retrying", async () => {
    chatCompletion.mockRejectedValue(new Error("401 unauthorized"));

    await expect(
      completeJson({
        messages: [{ role: "user", content: "go" }],
        schema: Schema,
      }),
    ).rejects.toThrow("401 unauthorized");

    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });
});
