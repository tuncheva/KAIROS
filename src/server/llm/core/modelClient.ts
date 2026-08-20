/**
 * LLM model client — one OpenAI-compatible `/chat/completions` endpoint.
 *
 * Configured by `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`, with an optional
 * `LLM_FALLBACK_MODEL` tried only when the primary fails retriably. Config comes
 * from `~/env` rather than raw `process.env` so a typo is a validation error at
 * boot instead of an `undefined` at request time.
 *
 * What this layer owns:
 *
 * - **Retries.** Transient upstream failures (429/5xx/network/timeout) are retried
 *   with exponential backoff and jitter, honouring `Retry-After`. Anything else —
 *   a 400 for a bad parameter, a 401 for a bad key — fails immediately, because
 *   retrying it only wastes the user's latency budget.
 * - **Truncation.** `finish_reason: "length"` is a real failure, not a response.
 *   It raises {@link TruncatedResponseError} so callers can retry with a larger
 *   budget instead of feeding half a JSON object into a repair prompt.
 * - **Tool calling.** `tools`/`tool_choice` in, `toolCalls` out, plus the message
 *   shapes needed to feed results back. The loop itself lives in `toolLoop.ts`.
 * - **Streaming.** {@link streamCompletion} yields reasoning and content deltas
 *   separately: the configured model emits `reasoning_content`, which is most of
 *   the token volume and must never reach a JSON parser or the chat transcript.
 * - **Observability.** One structured line per call with model, attempt, latency,
 *   token counts and finish reason.
 */

import "server-only";

import { env } from "~/env";
import { createLogger } from "~/server/logger";

const log = createLogger("llm");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS_PER_MODEL = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

/**
 * Default output budget.
 *
 * The configured model is a reasoning model: `max_tokens` covers
 * `reasoning_content` *and* the answer, and reasoning routinely consumes the
 * larger share. A budget sized for the answer alone truncates before the first
 * visible character — at 64 tokens this model produced zero content.
 */
const DEFAULT_MAX_TOKENS = 8192;

function getBaseUrl(): string {
  return (env.LLM_BASE_URL ?? "").replace(/\/+$/, "");
}

function getApiKey(): string {
  return env.LLM_API_KEY ?? "";
}

/** Primary model, then the optional fallback. Empty strings are dropped. */
function getModelChain(): string[] {
  return [env.LLM_MODEL, env.LLM_FALLBACK_MODEL].filter(
    (m): m is string => typeof m === "string" && m.length > 0,
  );
}

/** True when the AI features have enough configuration to run at all. */
export function isLlmConfigured(): boolean {
  return Boolean(getBaseUrl() && getApiKey() && getModelChain().length > 0);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as emitted by the model; parse defensively. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Pin a model and skip the fallback chain. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask for `response_format: json_object`. Ignored when `tools` is set. */
  jsonMode?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  /** Caller cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Free-form label for the log line, e.g. "a1.draft" or "jsonRepair". */
  purpose?: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Provider-reported prompt cache hit, when available. */
  cachedPromptTokens?: number;
}

export interface ChatResponse {
  content: string;
  /** Chain-of-thought from a reasoning model. Never parse or display this. */
  reasoning?: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  /** The model that actually served the request. */
  model: string;
  usage?: ChatUsage;
}

/**
 * The model hit its output cap mid-generation.
 *
 * Distinct from a parse failure: the text is not malformed, it is incomplete, and
 * the fix is a larger `max_tokens` or a smaller request — never a repair prompt.
 */
export class TruncatedResponseError extends Error {
  readonly partialContent: string;
  readonly maxTokens: number;

  constructor(partialContent: string, maxTokens: number) {
    super(
      `Model output was truncated at max_tokens=${String(maxTokens)} (${String(partialContent.length)} chars produced)`,
    );
    this.name = "TruncatedResponseError";
    this.partialContent = partialContent;
    this.maxTokens = maxTokens;
  }
}

/** An upstream HTTP failure, carrying the status so callers can branch on it. */
export class LlmHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`LLM request failed (${String(status)}): ${body.slice(0, 500)}`);
    this.name = "LlmHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface WireMessage {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: WireToolCall[];
}

interface WireChoice {
  index?: number;
  message?: WireMessage;
  delta?: WireMessage & { tool_calls?: Array<WireToolCall & { index?: number }> };
  finish_reason?: string | null;
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
}

interface WireCompletion {
  id?: string;
  model?: string;
  choices?: WireChoice[];
  usage?: WireUsage;
}

function toWireMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toWireTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function readToolCalls(calls: WireToolCall[] | undefined): ToolCall[] {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: c.id ?? `call_${String(i)}`,
      name: c.function?.name ?? "",
      arguments: c.function?.arguments ?? "{}",
    }));
}

function readUsage(usage: WireUsage | undefined): ChatUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    ...(typeof usage.prompt_cache_hit_tokens === "number"
      ? { cachedPromptTokens: usage.prompt_cache_hit_tokens }
      : {}),
  };
}

function buildBody(
  req: ChatRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(req.messages),
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  if (stream) {
    body.stream = true;
    // Without this a streamed call reports no usage at all, so streaming would
    // be a blind spot in the cost accounting.
    body.stream_options = { include_usage: true };
  }

  if (req.tools?.length) {
    body.tools = toWireTools(req.tools);
    body.tool_choice = req.toolChoice ?? "auto";
    // Providers reject `response_format` alongside `tools`, and a tool-calling
    // turn has no JSON payload to constrain anyway — the structured answer comes
    // from the final, tool-free call.
    if (req.jsonMode) {
      log.debug("jsonMode ignored because tools were supplied", { model });
    }
  } else if (req.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

/**
 * Statuses worth retrying.
 *
 * 5xx and 429 are transient by definition. 408/425 are timing failures. Anything
 * else — 400 for a malformed request, 401/403 for a bad key, 404 for an unknown
 * model — will fail identically on every attempt.
 */
const RETRIABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetriable(err: unknown): boolean {
  if (err instanceof LlmHttpError) return RETRIABLE_STATUS.has(err.status);
  if (err instanceof TruncatedResponseError) return false;
  if (err instanceof Error) {
    // AbortSignal.timeout raises TimeoutError; fetch raises TypeError on a
    // dropped connection or DNS failure.
    if (err.name === "TimeoutError") return true;
    if (err.name === "TypeError") return true;
  }
  return false;
}

/** `Retry-After` may be seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Exponential backoff with full jitter, so retries don't synchronise. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(Math.random() * ceiling);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Combine the caller's signal with a timeout.
 *
 * `AbortSignal.any` is not available on every Node version this runs on, so wire
 * it manually and hand back a disposer to avoid leaking listeners.
 */
function withTimeout(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("TimeoutError")), timeoutMs);

  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function assertConfigured(): void {
  if (!getApiKey()) {
    log.error("LLM_API_KEY is not set — every AI feature will fail");
    throw new Error(
      "LLM_API_KEY is not set. Add your provider key to .env (see .env.example).",
    );
  }
  if (!getBaseUrl()) {
    throw new Error("LLM_BASE_URL is not set. Add it to .env (see .env.example).");
  }
  if (getModelChain().length === 0) {
    throw new Error("LLM_MODEL is not set. Add it to .env (see .env.example).");
  }
}

async function toHttpError(res: Response): Promise<LlmHttpError> {
  const text = await res.text().catch(() => "");
  return new LlmHttpError(
    res.status,
    text,
    parseRetryAfter(res.headers.get("retry-after")),
  );
}

// ---------------------------------------------------------------------------
// Non-streaming
// ---------------------------------------------------------------------------

async function singleCompletion(
  req: ChatRequest,
  model: string,
): Promise<ChatResponse> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, dispose } = withTimeout(timeoutMs, req.signal);
  const startedAt = Date.now();

  try {
    const res = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildBody(req, model, false)),
      signal,
    });

    if (!res.ok) throw await toHttpError(res);

    const data = (await res.json()) as WireCompletion;
    const choice = data.choices?.[0];
    if (!choice?.message) throw new Error("LLM returned no choices");

    const content = choice.message.content ?? "";
    const toolCalls = readToolCalls(choice.message.tool_calls);
    const finishReason = choice.finish_reason ?? null;
    const usage = readUsage(data.usage);

    log.info("completion", {
      purpose: req.purpose ?? "unspecified",
      model: data.model ?? model,
      latencyMs: Date.now() - startedAt,
      finishReason,
      toolCalls: toolCalls.length,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      cachedPromptTokens: usage?.cachedPromptTokens,
    });

    // Truncation is only a failure when the model was producing an answer. A
    // tool-calling turn that stops at the cap still yields usable calls.
    if (finishReason === "length" && toolCalls.length === 0) {
      throw new TruncatedResponseError(content, req.maxTokens ?? DEFAULT_MAX_TOKENS);
    }

    return {
      content,
      reasoning: choice.message.reasoning_content ?? undefined,
      toolCalls,
      finishReason,
      model: data.model ?? model,
      usage,
    };
  } finally {
    dispose();
  }
}

/**
 * Send a chat completion, retrying transient failures and falling back to the
 * secondary model once the primary is exhausted.
 *
 * Pinning `req.model` skips the chain and uses only that model.
 */
export async function chatCompletion(req: ChatRequest): Promise<ChatResponse> {
  assertConfigured();

  const chain = req.model ? [req.model] : getModelChain();
  let lastError: unknown;

  for (const model of chain) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        return await singleCompletion(req, model);
      } catch (err) {
        lastError = err;
        if (!isRetriable(err)) throw err;

        const isLastAttempt = attempt === MAX_ATTEMPTS_PER_MODEL - 1;
        if (isLastAttempt) {
          log.warn("model exhausted its attempts", { model, err });
          break;
        }

        const wait =
          err instanceof LlmHttpError && err.retryAfterMs !== undefined
            ? err.retryAfterMs
            : backoffMs(attempt);
        log.warn("retriable LLM failure, backing off", {
          model,
          attempt: attempt + 1,
          waitMs: wait,
          err,
        });
        await sleep(wait, req.signal);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All configured models failed");
}

/** Send a system + user prompt and get the text back. */
export async function simpleCompletion(
  systemPrompt: string,
  userMessage: string,
  opts?: {
    model?: string;
    temperature?: number;
    jsonMode?: boolean;
    maxTokens?: number;
    signal?: AbortSignal;
    purpose?: string;
  },
): Promise<string> {
  const res = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    model: opts?.model,
    temperature: opts?.temperature,
    jsonMode: opts?.jsonMode,
    maxTokens: opts?.maxTokens,
    signal: opts?.signal,
    purpose: opts?.purpose,
  });
  return res.content;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export type StreamEvent =
  /** Chain-of-thought token. Show a working indicator; never append to the transcript. */
  | { type: "reasoning"; text: string }
  /** Answer token, safe to render. */
  | { type: "content"; text: string }
  /** Terminal event, always emitted exactly once on success. */
  | {
      type: "done";
      content: string;
      reasoning: string;
      toolCalls: ToolCall[];
      finishReason: string | null;
      model: string;
      usage?: ChatUsage;
    };

/** Accumulates `delta.tool_calls` fragments, which arrive split across frames. */
class ToolCallAccumulator {
  private readonly byIndex = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  push(deltas: Array<WireToolCall & { index?: number }> | undefined): void {
    if (!Array.isArray(deltas)) return;
    for (const [i, delta] of deltas.entries()) {
      const index = delta.index ?? i;
      const existing = this.byIndex.get(index) ?? { id: "", name: "", args: "" };
      this.byIndex.set(index, {
        id: delta.id ?? existing.id,
        name: delta.function?.name ?? existing.name,
        args: existing.args + (delta.function?.arguments ?? ""),
      });
    }
  }

  toToolCalls(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, v]) => v.name)
      .map(([index, v]) => ({
        id: v.id || `call_${String(index)}`,
        name: v.name,
        arguments: v.args || "{}",
      }));
  }
}

/**
 * Stream a completion, yielding reasoning and content separately.
 *
 * The connection attempt is retried like a non-streaming call, but only until the
 * first frame arrives — once tokens are flowing a failure cannot be replayed
 * without showing the user the answer twice.
 */
export async function* streamCompletion(
  req: ChatRequest,
): AsyncGenerator<StreamEvent, void, undefined> {
  assertConfigured();

  const chain = req.model ? [req.model] : getModelChain();
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (const model of chain) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const { signal, dispose } = withTimeout(timeoutMs, req.signal);
      const startedAt = Date.now();

      let res: Response;
      try {
        res = await fetch(`${getBaseUrl()}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getApiKey()}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(buildBody(req, model, true)),
          signal,
        });
        if (!res.ok) throw await toHttpError(res);
        if (!res.body) throw new Error("LLM returned no response body");
      } catch (err) {
        dispose();
        lastError = err;
        if (!isRetriable(err)) throw err;
        if (attempt < MAX_ATTEMPTS_PER_MODEL - 1) {
          await sleep(
            err instanceof LlmHttpError && err.retryAfterMs !== undefined
              ? err.retryAfterMs
              : backoffMs(attempt),
            req.signal,
          );
          continue;
        }
        break;
      }

      // Past this point the response is committed: surface failures rather than
      // restarting and double-rendering.
      try {
        yield* readStream(res.body, model, startedAt, req.purpose);
        return;
      } finally {
        dispose();
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All configured models failed");
}

async function* readStream(
  body: ReadableStream<Uint8Array>,
  requestedModel: string,
  startedAt: number,
  purpose?: string,
): AsyncGenerator<StreamEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new ToolCallAccumulator();

  let buffer = "";
  let content = "";
  let reasoning = "";
  let finishReason: string | null = null;
  let servedModel = requestedModel;
  let usage: ChatUsage | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last element is a partial line; keep it for the next chunk.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        let frame: WireCompletion;
        try {
          frame = JSON.parse(payload) as WireCompletion;
        } catch {
          // A malformed frame is not worth failing the whole stream over.
          continue;
        }

        if (frame.model) servedModel = frame.model;
        if (frame.usage) usage = readUsage(frame.usage);

        const choice = frame.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          yield { type: "reasoning", text: delta.reasoning_content };
        }
        if (delta.content) {
          content += delta.content;
          yield { type: "content", text: delta.content };
        }
        toolCalls.push(delta.tool_calls);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const calls = toolCalls.toToolCalls();

  log.info("completion (stream)", {
    purpose: purpose ?? "unspecified",
    model: servedModel,
    latencyMs: Date.now() - startedAt,
    finishReason,
    toolCalls: calls.length,
    // Not `contentChars`: the logger redacts any key containing "content", which
    // is there to keep note and message bodies out of logs. Keep that intact.
    answerChars: content.length,
    reasoningChars: reasoning.length,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    cachedPromptTokens: usage?.cachedPromptTokens,
  });

  yield {
    type: "done",
    content,
    reasoning,
    toolCalls: calls,
    finishReason,
    model: servedModel,
    usage,
  };
}
