import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `~/env` validates at import time and the client reads its config from there,
 * so it is mocked before the module under test is imported.
 */
vi.mock("~/env", () => ({
  env: {
    LLM_BASE_URL: "https://llm.test/api/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "primary-model",
    LLM_FALLBACK_MODEL: "fallback-model",
    AUTH_SECRET: "x".repeat(32),
  },
}));

const {
  chatCompletion,
  streamCompletion,
  TruncatedResponseError,
  LlmHttpError,
  isLlmConfigured,
} = await import("~/server/llm/core/modelClient");

/** A minimal OpenAI-shaped completion response. */
function completion(
  message: Record<string, unknown>,
  opts: { finishReason?: string | null; model?: string; usage?: unknown } = {},
) {
  return new Response(
    JSON.stringify({
      model: opts.model ?? "primary-model",
      choices: [
        { index: 0, message, finish_reason: opts.finishReason ?? "stop" },
      ],
      usage: opts.usage ?? {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { message: "upstream" } }), {
    status,
    headers,
  });
}

/** Turn SSE frames into a streaming Response. */
function sseResponse(frames: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const USER = [{ role: "user" as const, content: "hello" }];

/** The JSON body of the nth fetch call. `vi.fn()` mock args are untyped. */
function requestBody(index: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("modelClient — configuration", () => {
  it("reports configured when base url, key and model are all present", () => {
    expect(isLlmConfigured()).toBe(true);
  });
});

describe("modelClient — responses", () => {
  it("returns content, and keeps reasoning out of it", async () => {
    fetchMock.mockResolvedValue(
      completion({
        role: "assistant",
        content: '{"ok":true}',
        reasoning_content: "let me think about this",
      }),
    );

    const res = await chatCompletion({ messages: USER });

    expect(res.content).toBe('{"ok":true}');
    expect(res.reasoning).toBe("let me think about this");
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("surfaces the provider's prompt cache hits", async () => {
    fetchMock.mockResolvedValue(
      completion(
        { role: "assistant", content: "hi" },
        {
          usage: {
            prompt_tokens: 100,
            completion_tokens: 5,
            total_tokens: 105,
            prompt_cache_hit_tokens: 64,
          },
        },
      ),
    );

    const res = await chatCompletion({ messages: USER });
    expect(res.usage?.cachedPromptTokens).toBe(64);
  });

  it("parses tool calls", async () => {
    fetchMock.mockResolvedValue(
      completion(
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "listTasks", arguments: '{"projectId":7}' },
            },
          ],
        },
        { finishReason: "tool_calls" },
      ),
    );

    const res = await chatCompletion({ messages: USER });
    expect(res.toolCalls).toEqual([
      { id: "call_1", name: "listTasks", arguments: '{"projectId":7}' },
    ]);
  });

  it("sends tool definitions and drops jsonMode when tools are present", async () => {
    fetchMock.mockResolvedValue(completion({ role: "assistant", content: "x" }));

    await chatCompletion({
      messages: USER,
      jsonMode: true,
      tools: [{ name: "t", description: "d", parameters: { type: "object" } }],
    });

    const body = requestBody(0);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
    // The provider rejects response_format alongside tools.
    expect(body.response_format).toBeUndefined();
  });

  it("requests json_object when jsonMode is set without tools", async () => {
    fetchMock.mockResolvedValue(completion({ role: "assistant", content: "{}" }));

    await chatCompletion({ messages: USER, jsonMode: true });

    const body = requestBody(0);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  /**
   * Hybrid-thinking models gate reasoning behind a chat-template flag whose shape
   * differs per model. Sending the wrong key fails *silently* — the template
   * ignores it and the model answers with no reasoning — so nothing downstream
   * would catch a regression here. These assert the wire body directly.
   */
  it.each([
    [
      "deepseek-ai/deepseek-v4-flash-0731",
      { thinking: true, reasoning_effort: "high" },
    ],
    ["nvidia/nemotron-3-super-120b-a12b", { enable_thinking: true }],
  ])("sends the chat template kwargs %s expects", async (model, expected) => {
    fetchMock.mockResolvedValue(completion({ role: "assistant", content: "ok" }));

    await chatCompletion({ messages: USER, model });

    // Top level, not nested under extra_body: that is the shape the NIM reads.
    // The dated suffix on the DeepSeek id is deliberate — entries match by
    // prefix, so a new build of a known family inherits its flags for free.
    expect(requestBody(0).chat_template_kwargs).toEqual(expected);
  });

  it("sends no chat template kwargs for a plain instruct model", async () => {
    fetchMock.mockResolvedValue(completion({ role: "assistant", content: "ok" }));

    await chatCompletion({ messages: USER, model: "meta/some-instruct-model" });

    // Absent, not empty: an unlisted model has no thinking mode to switch on.
    expect(requestBody(0)).not.toHaveProperty("chat_template_kwargs");
  });

  it("serializes tool results back to the wire format", async () => {
    fetchMock.mockResolvedValue(completion({ role: "assistant", content: "ok" }));

    await chatCompletion({
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_1", name: "listTasks", arguments: "{}" }],
        },
        { role: "tool", toolCallId: "call_1", content: "[]" },
      ],
    });

    const body = requestBody(0) as unknown as {
      messages: Array<Record<string, unknown>>;
    };

    expect(body.messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "listTasks" } },
      ],
    });
    expect(body.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "[]",
    });
  });
});

describe("modelClient — truncation", () => {
  /**
   * The configured model spends part of its budget on reasoning before writing
   * any answer, so a too-small budget returns `finish_reason: "length"` with
   * empty content. That is an incomplete response, not a malformed one — sending
   * it to a JSON repair prompt would invent the missing half.
   */
  it("raises TruncatedResponseError when the model hits max_tokens", async () => {
    fetchMock.mockResolvedValue(
      completion(
        { role: "assistant", content: '{"partial":' },
        { finishReason: "length" },
      ),
    );

    await expect(
      chatCompletion({ messages: USER, maxTokens: 64 }),
    ).rejects.toBeInstanceOf(TruncatedResponseError);
  });

  it("does not treat a truncated tool-calling turn as a failure", async () => {
    fetchMock.mockResolvedValue(
      completion(
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "c1", type: "function", function: { name: "t", arguments: "{}" } },
          ],
        },
        { finishReason: "length" },
      ),
    );

    const res = await chatCompletion({ messages: USER });
    expect(res.toolCalls).toHaveLength(1);
  });

  it("never retries a truncated response", async () => {
    fetchMock.mockResolvedValue(
      completion({ role: "assistant", content: "x" }, { finishReason: "length" }),
    );

    await expect(chatCompletion({ messages: USER })).rejects.toBeInstanceOf(
      TruncatedResponseError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("modelClient — retries and fallback", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])(
    "retries HTTP %i",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(status))
        .mockResolvedValueOnce(completion({ role: "assistant", content: "ok" }));

      const res = await chatCompletion({ messages: USER });

      expect(res.content).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([400, 401, 403])(
    "fails immediately on HTTP %i, without reaching the fallback",
    async (status) => {
      fetchMock.mockResolvedValue(errorResponse(status));

      await expect(chatCompletion({ messages: USER })).rejects.toBeInstanceOf(
        LlmHttpError,
      );
      // A malformed request or a bad key fails identically on every attempt and
      // on every model; retrying only spends the user's latency budget.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([404, 422])(
    "does not retry HTTP %i, but does advance the chain",
    async (status) => {
      fetchMock.mockResolvedValue(errorResponse(status));

      await expect(chatCompletion({ messages: USER })).rejects.toBeInstanceOf(
        LlmHttpError,
      );
      // A model this account cannot reach is a property of *that* endpoint, not
      // of the request, so the fallback is worth trying — but only once each: the
      // status is no more retriable on the second model than it was on the first.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("falls back to the secondary model once the primary is exhausted", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(
        completion({ role: "assistant", content: "from fallback" }, {
          model: "fallback-model",
        }),
      );

    const res = await chatCompletion({ messages: USER });

    expect(res.content).toBe("from fallback");
    expect(res.model).toBe("fallback-model");

    const modelsTried = fetchMock.mock.calls.map(
      (_call, i) => requestBody(i).model,
    );
    expect(modelsTried).toEqual([
      "primary-model",
      "primary-model",
      "primary-model",
      "fallback-model",
    ]);
  });

  it("skips the fallback chain when a model is pinned", async () => {
    fetchMock.mockResolvedValue(errorResponse(503));

    await expect(
      chatCompletion({ messages: USER, model: "pinned" }),
    ).rejects.toBeInstanceOf(LlmHttpError);

    const modelsTried = new Set(
      fetchMock.mock.calls.map((_call, i) => requestBody(i).model),
    );
    expect([...modelsTried]).toEqual(["pinned"]);
  });

  it("retries a dropped connection", async () => {
    const networkError = new TypeError("fetch failed");
    fetchMock
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(completion({ role: "assistant", content: "ok" }));

    const res = await chatCompletion({ messages: USER });
    expect(res.content).toBe("ok");
  });
});

describe("modelClient — streaming", () => {
  it("yields reasoning and content separately, then a done event", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"model":"primary-model","choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const events = [];
    for await (const event of streamCompletion({ messages: USER })) {
      events.push(event);
    }

    expect(events.filter((e) => e.type === "reasoning")).toEqual([
      { type: "reasoning", text: "hmm" },
    ]);
    expect(
      events.filter((e) => e.type === "content").map((e) => e.text),
    ).toEqual(["Hello", " world"]);

    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      content: "Hello world",
      reasoning: "hmm",
      finishReason: "stop",
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    });
  });

  it("requests usage accounting for streamed calls", async () => {
    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));

    for await (const _ of streamCompletion({ messages: USER })) {
      // drain
    }

    const body = requestBody(0);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("reassembles tool call fragments split across frames", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"listTasks","arguments":"{\\"proj"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ectId\\":7}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const events = [];
    for await (const event of streamCompletion({ messages: USER })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "done",
      toolCalls: [
        { id: "call_1", name: "listTasks", arguments: '{"projectId":7}' },
      ],
    });
  });

  it("survives a malformed frame instead of failing the whole stream", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        "data: {not json}\n\n",
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const events = [];
    for await (const event of streamCompletion({ messages: USER })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "done", content: "ok" });
  });

  it("handles a frame split across two network chunks", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"con',
        'tent":"split"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const events = [];
    for await (const event of streamCompletion({ messages: USER })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "done", content: "split" });
  });
});
