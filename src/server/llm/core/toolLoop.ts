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
  type ChatMessage,
  type ChatUsage,
  type ToolCall,
  type ToolDefinition,
} from "./modelClient";

const log = createLogger("llm.toolLoop");

/** Enough hops to chain listProjects → getProjectDetail → listTasks → getTaskDetail and answer. */
const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_WALL_CLOCK_MS = 90_000;

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

    const response = await chatCompletion({
      messages,
      // On the last iteration — or once out of time — drop the tools so the
      // model has to answer with what it has instead of asking for more.
      tools: iteration === maxIterations || outOfTime ? undefined : opts.tools,
      toolChoice: "auto",
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      purpose: `${opts.purpose ?? "toolLoop"}#${String(iteration)}`,
    });

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

    // Sequential, not parallel: these are DB reads on one connection pool, and a
    // later call in the same turn often depends on an id from an earlier one.
    for (const call of response.toolCalls) {
      opts.onToolCall?.(call.name);
      const { message, ok, durationMs } = await executeToolCall(
        opts,
        call,
        resultCache,
      );
      toolCallsMade.push({ name: call.name, ok, durationMs });
      messages.push(message);
      log.debug("tool call", { tool: call.name, ok, durationMs });
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
