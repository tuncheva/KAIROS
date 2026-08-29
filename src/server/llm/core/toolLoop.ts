/**
 * The agent tool loop.
 *
 * Call the model with a set of tools; if it asks for one, run it and feed the
 * result back; repeat until it answers. This is what makes the assistant able to
 * look things up. Before it existed, `buildA1Context` pre-loaded a fixed slice of
 * the workspace into the system prompt — ten projects, ten tasks each — and any
 * question outside that slice was unanswerable by construction.
 *
 * Safety properties, in order of importance:
 *
 * 1. **Every tool call is authorized.** Tools receive the caller's `TRPCContext`
 *    and run the same `assertProjectAccess` checks the tRPC routers do. The model
 *    chooses *which* id to ask for; it never decides whether it may have it.
 * 2. **Only allowlisted tools run.** The name comes from model output, so it is
 *    checked against the agent profile rather than looked up directly.
 * 3. **The loop is bounded** — iterations, wall clock, and the caller's abort
 *    signal — so a model that loops forever costs a known maximum.
 *
 * Tool failures are returned to the model as content rather than thrown: "that
 * project does not exist" is something it can recover from by trying another,
 * and turning it into a 500 would waste the whole turn.
 */

import "server-only";

import { TRPCError } from "@trpc/server";
import type { z } from "zod";

import type { TRPCContext } from "~/server/api/trpc";
import { createLogger } from "~/server/logger";
import { recordExtraAiCall } from "~/server/security/rateLimit";

import {
  chatCompletion,
  streamCompletion,
  type ChatMessage,
  type ChatResponse,
  type ChatUsage,
  type ToolCall,
  type ToolDefinition,
} from "./modelClient";
import { createPlainTextFilter } from "~/server/llm/core/plainText";
import { createSummaryStream } from "./summaryStream";

const log = createLogger("llm.toolLoop");

/**
 * Enough hops to chain searchWorkspace → getProjectDetail → listTasks →
 * getTaskDetail → listTaskComments and still have a turn left to answer in.
 *
 * Was 6, sized for a surface of eight tools where almost every question was one
 * or two lookups. With nineteen tools the model legitimately takes more hops —
 * search first, then drill down — and hitting the cap does not degrade the
 * answer, it discards the turn entirely (`exhausted`).
 */
const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_WALL_CLOCK_MS = 90_000;

/**
 * How many tool calls from one model turn may run at once.
 *
 * Bounded rather than unlimited: these are database round trips on a shared
 * pool, and a model that asks for twelve lookups should not be able to occupy
 * the pool by itself.
 */
const TOOL_CONCURRENCY = 4;

/** Truncation guard for a tool result, so one huge row set cannot fill the context. */
const MAX_TOOL_RESULT_CHARS = 12_000;

export interface LoopTool {
  name: string;
  inputSchema: z.ZodType<never> | z.ZodTypeAny;
  execute: (ctx: TRPCContext, input: never) => Promise<unknown>;
}

export interface ToolLoopOptions {
  ctx: TRPCContext;
  userId: string;
  messages: ChatMessage[];
  /** What the model may call, already filtered by the agent's allowlist. */
  tools: ToolDefinition[];
  /** Implementations, keyed by name. A name absent here is refused. */
  registry: Record<string, LoopTool>;
  maxIterations?: number;
  wallClockMs?: number;
  temperature?: number;
  maxTokens?: number;
  purpose?: string;
  signal?: AbortSignal;
  /** Called as each tool starts, for progress UI. */
  onToolCall?: (name: string) => void;
  /**
   * G-1 — called with the answer text as it streams.
   *
   * Setting this switches the model call from a single response to a streamed
   * one, and the characters of `answer.summary` are emitted as they decode. The
   * complete response is still assembled and validated exactly as before; this
   * is a view onto the same bytes, not a second contract.
   */
  onAnswerDelta?: (text: string) => void;
}

export interface ToolLoopResult {
  /** The model's final answer text. */
  content: string;
  /** Full transcript including tool calls and results, for persistence. */
  messages: ChatMessage[];
  iterations: number;
  toolCallsMade: Array<{ name: string; ok: boolean; durationMs: number }>;
  usage: ChatUsage;
  /** True when the loop stopped on its iteration cap rather than a real answer. */
  exhausted: boolean;
}

function addUsage(total: ChatUsage, next?: ChatUsage): ChatUsage {
  if (!next) return total;
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
    cachedPromptTokens:
      (total.cachedPromptTokens ?? 0) + (next.cachedPromptTokens ?? 0),
  };
}

/** Serialize a tool result for the model, capped so one call cannot flood the context. */
function serializeResult(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return `${json.slice(0, MAX_TOOL_RESULT_CHARS)}\n…truncated. Narrow the query with a smaller limit or a more specific id.`;
}

/**
 * Run one tool call.
 *
 * Never throws: every failure becomes a message the model can read and react to.
 */
async function executeToolCall(
  opts: ToolLoopOptions,
  call: ToolCall,
  cache: Map<string, string>,
): Promise<{ message: ChatMessage; ok: boolean; durationMs: number }> {
  const startedAt = Date.now();

  const reply = (content: string, ok: boolean): {
    message: ChatMessage;
    ok: boolean;
    durationMs: number;
  } => ({
    message: { role: "tool", toolCallId: call.id, content },
    ok,
    durationMs: Date.now() - startedAt,
  });

  // The name is model output. Only a tool the profile allows may run.
  const tool = opts.registry[call.name];
  if (!tool) {
    log.warn("model requested a tool outside its allowlist", { tool: call.name });
    return reply(
      `Error: no tool named "${call.name}" is available to you. Available tools: ${opts.tools.map((t) => t.name).join(", ")}.`,
      false,
    );
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = call.arguments.trim() ? JSON.parse(call.arguments) : {};
  } catch {
    return reply(
      `Error: arguments for "${call.name}" were not valid JSON. Send a JSON object.`,
      false,
    );
  }

  const validated = tool.inputSchema.safeParse(parsedArgs);
  if (!validated.success) {
    return reply(
      `Error: invalid arguments for "${call.name}": ${validated.error.message}`,
      false,
    );
  }

  // Repeated identical calls are common: the model re-fetches a project it
  // already has and burns an iteration doing it. Serve the earlier result and
  // say so, which both spares the database and nudges it to move on.
  const cacheKey = `${call.name}:${JSON.stringify(validated.data)}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return reply(
      `${cached}\n\n(You already called ${call.name} with these arguments — this is the same result. Answer the user now.)`,
      true,
    );
  }

  try {
    const result = await tool.execute(opts.ctx, validated.data as never);
    const serialized = serializeResult(result);
    cache.set(cacheKey, serialized);
    return reply(serialized, true);
  } catch (err) {
    // Authorization failures land here. Tell the model it cannot have the record
    // without leaking whether it exists — the tools already fail closed.
    if (err instanceof TRPCError) {
      return reply(`Error: ${err.code} — ${err.message}`, false);
    }
    log.error("tool execution failed", { tool: call.name, err });
    return reply(
      `Error: "${call.name}" failed. Answer from what you already know, or tell the user you could not look it up.`,
      false,
    );
  }
}

/**
 * Run one model call as a stream, forwarding the answer text as it decodes.
 *
 * Returns the same {@link ChatResponse} the non-streaming path does, so the loop
 * above is identical either way — the only difference is that the caller saw the
 * answer arrive instead of waiting for it.
 *
 * A tool-calling turn produces no `answer.summary` at all, and the scanner
 * simply finds nothing; there is no need to know in advance which kind of turn
 * this is.
 */
async function streamAnswer(
  request: Parameters<typeof chatCompletion>[0],
  onAnswerDelta: (text: string) => void,
): Promise<ChatResponse> {
  // The client renders these deltas as plain text, so the Markdown the model
  // insists on writing has to come off before they leave the server — not just
  // off the final object, or the user watches the asterisks type themselves out
  // and then vanish. See `createPlainTextFilter`.
  const plain = createPlainTextFilter(onAnswerDelta);
  const scanner = createSummaryStream({ onDelta: (text) => plain.push(text) });

  for await (const event of streamCompletion(request)) {
    if (event.type === "content") {
      scanner.push(event.text);
      continue;
    }
    if (event.type === "done") {
      scanner.end();
      plain.end();
      return {
        content: event.content,
        reasoning: event.reasoning,
        toolCalls: event.toolCalls,
        finishReason: event.finishReason,
        model: event.model,
        usage: event.usage,
      };
    }
    // `reasoning` deltas are deliberately dropped: they are most of the token
    // volume and must never reach the transcript.
  }

  // The generator ended without a `done` event, which means the upstream stream
  // was cut. Surfaced as an error rather than an empty answer, so the caller's
  // fallback path runs instead of the user seeing a blank reply.
  scanner.end();
  plain.end();
  throw new Error("The model stream ended without completing.");
}

/**
 * Drive the model until it produces an answer, executing the tools it asks for.
 */
export async function runToolLoop(
  opts: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const deadline = Date.now() + (opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);

  const messages: ChatMessage[] = [...opts.messages];
  const toolCallsMade: ToolLoopResult["toolCallsMade"] = [];
  /** Results already fetched this turn, keyed by tool name + arguments. */
  const resultCache = new Map<string, string>();
  let usage: ChatUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const outOfTime = Date.now() > deadline;

    const request = {
      messages,
      // On the last iteration — or once out of time — drop the tools so the
      // model has to answer with what it has instead of asking for more.
      tools: iteration === maxIterations || outOfTime ? undefined : opts.tools,
      toolChoice: "auto" as const,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      purpose: `${opts.purpose ?? "toolLoop"}#${String(iteration)}`,
    };

    const response = opts.onAnswerDelta
      ? await streamAnswer(request, opts.onAnswerDelta)
      : await chatCompletion(request);

    usage = addUsage(usage, response.usage);
    // The first call is paid for by the caller's `consumeRateLimit`; each extra
    // hop is a further billed completion and is recorded as one.
    if (iteration > 1) await recordExtraAiCall(opts.userId);

    if (response.toolCalls.length === 0) {
      return {
        content: response.content,
        messages: [
          ...messages,
          { role: "assistant", content: response.content },
        ],
        iterations: iteration,
        toolCallsMade,
        usage,
        exhausted: false,
      };
    }

    messages.push({
      role: "assistant",
      content: response.content || null,
      toolCalls: response.toolCalls,
    });

    // Calls within one model turn run concurrently, in bounded batches.
    //
    // This was sequential, justified by "a later call in the same turn often
    // depends on an id from an earlier one" — but that is not what a turn is.
    // The model emits every call in a single response *before* seeing any
    // result, so no call here can depend on another; chaining happens across
    // iterations, which are still strictly sequential. With search in the tool
    // set the model now routinely asks for three or four lookups at once, and
    // paying for them serially was latency for nothing.
    //
    // Results are appended in the model's original order regardless of which
    // finished first: the tool messages must line up with the tool_call ids in
    // the preceding assistant message.
    for (let i = 0; i < response.toolCalls.length; i += TOOL_CONCURRENCY) {
      const batch = response.toolCalls.slice(i, i + TOOL_CONCURRENCY);

      const settled = await Promise.all(
        batch.map(async (call) => {
          opts.onToolCall?.(call.name);
          const outcome = await executeToolCall(opts, call, resultCache);
          return { call, ...outcome };
        }),
      );

      for (const { call, message, ok, durationMs } of settled) {
        toolCallsMade.push({ name: call.name, ok, durationMs });
        messages.push(message);
        log.debug("tool call", { tool: call.name, ok, durationMs });
      }
    }
  }

  // Every iteration asked for tools, including the tool-free final one. Nothing
  // useful left to do but say so.
  log.warn("tool loop hit its iteration cap", {
    purpose: opts.purpose,
    maxIterations,
    toolCalls: toolCallsMade.length,
  });

  return {
    content: "",
    messages,
    iterations: maxIterations,
    toolCallsMade,
    usage,
    exhausted: true,
  };
}
