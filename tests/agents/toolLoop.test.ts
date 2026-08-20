import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

vi.mock("~/env", () => ({
  env: {
    LLM_BASE_URL: "https://llm.test/api/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "primary-model",
    AUTH_SECRET: "x".repeat(32),
  },
}));

const chatCompletion = vi.fn();
vi.mock("~/server/llm/core/modelClient", () => ({ chatCompletion }));

const recordExtraAiCall = vi.fn();
vi.mock("~/server/security/rateLimit", () => ({ recordExtraAiCall }));

const { runToolLoop } = await import("~/server/llm/core/toolLoop");

type Ctx = Parameters<typeof runToolLoop>[0]["ctx"];
const ctx = {} as Ctx;

/** A model turn that requests one tool call. */
function toolTurn(name: string, args: unknown, id = "call_1") {
  return {
    content: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    finishReason: "tool_calls",
    model: "primary-model",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

/** A model turn that answers. */
function answerTurn(content: string) {
  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    model: "primary-model",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

const listTasks = vi.fn();

const registry = {
  listTasks: {
    name: "listTasks",
    inputSchema: z.object({ projectId: z.number() }).strict(),
    execute: listTasks,
  },
};

const tools = [
  {
    name: "listTasks",
    description: "List tasks",
    parameters: {
      type: "object",
      properties: { projectId: { type: "number" } },
      required: ["projectId"],
    },
  },
];

function run(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  return runToolLoop({
    ctx,
    userId: "user-1",
    messages: [{ role: "user", content: "how many tasks?" }],
    tools,
    registry,
    ...overrides,
  });
}

/** The request the loop made on its nth hop. `vi.fn()` mock args are untyped. */
function requestAt(index: number): { tools?: unknown[]; maxTokens?: number } {
  return chatCompletion.mock.calls[index]![0] as {
    tools?: unknown[];
    maxTokens?: number;
  };
}

/** The tool messages the loop fed back to the model. */
function toolReplies(result: Awaited<ReturnType<typeof runToolLoop>>) {
  return result.messages
    .filter((m): m is { role: "tool"; toolCallId: string; content: string } =>
      m.role === "tool",
    )
    .map((m) => m.content);
}

beforeEach(() => {
  vi.clearAllMocks();
  listTasks.mockResolvedValue([{ id: 1, title: "Ship it" }]);
});

describe("runToolLoop", () => {
  it("answers directly when the model asks for no tools", async () => {
    chatCompletion.mockResolvedValueOnce(answerTurn("42 tasks"));

    const result = await run();

    expect(result.content).toBe("42 tasks");
    expect(result.iterations).toBe(1);
    expect(result.toolCallsMade).toEqual([]);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("executes a requested tool and feeds the result back", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }))
      .mockResolvedValueOnce(answerTurn("one task"));

    const result = await run();

    expect(listTasks).toHaveBeenCalledWith(ctx, { projectId: 7 });
    expect(result.content).toBe("one task");
    expect(result.iterations).toBe(2);
    expect(result.toolCallsMade).toEqual([
      { name: "listTasks", ok: true, durationMs: expect.any(Number) as number },
    ]);
    expect(toolReplies(result)).toEqual(['[{"id":1,"title":"Ship it"}]']);
  });

  it("reports each tool call for progress display", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }))
      .mockResolvedValueOnce(answerTurn("done"));

    const onToolCall = vi.fn();
    await run({ onToolCall });

    expect(onToolCall).toHaveBeenCalledWith("listTasks");
  });

  it("sums usage across every hop", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }))
      .mockResolvedValueOnce(answerTurn("done"));

    const result = await run();
    expect(result.usage.totalTokens).toBe(30);
  });

  /**
   * The first call is paid for by `consumeRateLimit` at the door; each further
   * hop is another billed completion and has to be counted.
   */
  it("bills every hop after the first to the caller's budget", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }))
      .mockResolvedValueOnce(answerTurn("done"));

    await run();

    expect(recordExtraAiCall).toHaveBeenCalledTimes(1);
    expect(recordExtraAiCall).toHaveBeenCalledWith("user-1");
  });

  /* ---- Guard rails ---- */

  /**
   * The tool name comes from model output, so it is looked up in the profile's
   * registry rather than dispatched directly.
   */
  it("refuses a tool outside the registry without executing anything", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("deleteEverything", {}))
      .mockResolvedValueOnce(answerTurn("understood"));

    const result = await run();

    expect(listTasks).not.toHaveBeenCalled();
    expect(toolReplies(result)[0]).toContain('no tool named "deleteEverything"');
    expect(result.toolCallsMade[0]).toMatchObject({ ok: false });
  });

  it("rejects arguments that fail the tool's schema", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: "seven" }))
      .mockResolvedValueOnce(answerTurn("ok"));

    const result = await run();

    expect(listTasks).not.toHaveBeenCalled();
    expect(toolReplies(result)[0]).toContain("invalid arguments");
  });

  it("rejects arguments that are not valid JSON", async () => {
    chatCompletion
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "c1", name: "listTasks", arguments: "{oops" }],
        finishReason: "tool_calls",
        model: "primary-model",
      })
      .mockResolvedValueOnce(answerTurn("ok"));

    const result = await run();
    expect(toolReplies(result)[0]).toContain("not valid JSON");
  });

  /**
   * An authorization failure is information the model can act on — it should say
   * it could not look something up, not crash the turn.
   */
  it("returns an authorization failure to the model instead of throwing", async () => {
    listTasks.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN", message: "No access to this project" }),
    );
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 99 }))
      .mockResolvedValueOnce(answerTurn("I couldn't see that project"));

    const result = await run();

    expect(result.content).toBe("I couldn't see that project");
    expect(toolReplies(result)[0]).toContain("FORBIDDEN");
    expect(result.toolCallsMade[0]).toMatchObject({ ok: false });
  });

  it("does not leak internals when a tool throws an unexpected error", async () => {
    listTasks.mockRejectedValueOnce(
      new Error("connection to 10.0.0.4:5432 refused"),
    );
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }))
      .mockResolvedValueOnce(answerTurn("could not look it up"));

    const result = await run();

    expect(toolReplies(result)[0]).not.toContain("10.0.0.4");
    expect(toolReplies(result)[0]).toContain('"listTasks" failed');
  });

  /**
   * The model re-fetches data it already has, which costs a whole extra round
   * trip; the second identical call is served from the turn's cache.
   */
  it("serves a repeated identical call from cache", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }, "c1"))
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }, "c2"))
      .mockResolvedValueOnce(answerTurn("done"));

    const result = await run();

    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(toolReplies(result)[1]).toContain("You already called listTasks");
  });

  it("still executes a call with different arguments", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }, "c1"))
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 8 }, "c2"))
      .mockResolvedValueOnce(answerTurn("done"));

    await run();

    expect(listTasks).toHaveBeenCalledTimes(2);
  });

  it("truncates an oversized tool result", async () => {
    listTasks.mockResolvedValueOnce(
      Array.from({ length: 5000 }, (_, i) => ({ id: i, title: "x".repeat(50) })),
    );
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }))
      .mockResolvedValueOnce(answerTurn("lots"));

    const result = await run();

    expect(toolReplies(result)[0]).toContain("truncated");
    expect(toolReplies(result)[0]!.length).toBeLessThan(13_000);
  });

  /* ---- Bounds ---- */

  it("drops the tools on the final iteration to force an answer", async () => {
    chatCompletion
      .mockResolvedValueOnce(toolTurn("listTasks", { projectId: 7 }))
      .mockResolvedValueOnce(answerTurn("done"));

    await run({ maxIterations: 2 });

    expect(requestAt(0).tools).toHaveLength(1);
    expect(requestAt(1).tools).toBeUndefined();
  });

  it("reports exhaustion rather than looping forever", async () => {
    chatCompletion.mockResolvedValue(toolTurn("listTasks", { projectId: 7 }));

    const result = await run({ maxIterations: 3 });

    expect(result.exhausted).toBe(true);
    expect(result.content).toBe("");
    expect(chatCompletion).toHaveBeenCalledTimes(3);
  });

  it("stops sending tools once the wall clock is spent", async () => {
    chatCompletion.mockResolvedValueOnce(answerTurn("quick"));

    await run({ wallClockMs: -1 });

    expect(requestAt(0).tools).toBeUndefined();
  });
});
