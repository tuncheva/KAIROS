/**
 * LLM model client — one OpenAI-compatible `/chat/completions` endpoint.
 *
 * Configured by `LLM_PROVIDER` — a named preset in `providers.ts` carrying the
 * base URL, model chain and key variable for one gateway — or directly by
 * `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`, which override the preset when
 * set. `LLM_FALLBACK_MODEL` is tried only when the primary fails retriably.
 * Config comes from `~/env` rather than raw `process.env` so a typo is a
 * validation error at boot instead of an `undefined` at request time.
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
 * - **Failover.** The chain is primary models, then the backup provider's
 *   (`LLM_BACKUP_PROVIDER`), each a {@link Candidate}. A model that just failed
 *   in a way the next request would repeat — no first byte, quota gone, 404/410,
 *   a rejected key — is moved to the back of the chain for a cooldown, so later
 *   requests stop paying its timeout. It is demoted, never dropped: when every
 *   candidate is cooling down they are all still tried, in order of recovery.
 *   Once the chain is exhausted the caller gets {@link LlmUnavailableError}, which
 *   carries a message fit to show a user instead of an upstream response body.
 */

import "server-only";

import { env } from "~/env";
import { createLogger } from "~/server/logger";
import { currentUserReasoningEffort } from "./effortScope";
import { resolveLlmConfig, type ResolvedLlmLane } from "./providers";

const log = createLogger("llm");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000;
/**
 * How long a *streamed* request may stay silent before we call the endpoint dead.
 *
 * An endpoint that accepted the request but is not serving it sends nothing at
 * all — NVIDIA's gateway sits on such a request for a full 300s before returning
 * 504 — so the total budget is the wrong instrument for spotting it.
 *
 * Streaming only, and that restriction is load-bearing. Measured against this
 * provider:
 *
 * - `stream: true`  — headers at 0.6s, generation ran to 79s. Silence is signal.
 * - `stream: false` — headers at 40.04s, body complete at 40.05s. The gateway
 *   withholds headers until generation finishes, so "time to first byte" *is*
 *   "time to full answer" and any guard short enough to be useful would kill
 *   healthy calls.
 *
 * That is why {@link chatCompletion} streams on the wire and assembles the answer
 * itself. It used to send `stream: false` and so had only the total budget as a
 * clock. A model that never answered cost 120s per attempt, three attempts per
 * model, and that was most of what "the AI is not working" looked like. Streamed,
 * the same dead model is detected in 20s, once.
 */
const FIRST_BYTE_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS_PER_MODEL = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
/** Cooldown for faults that tend to clear: silence, quota, exhausted 5xx retries. */
const COOLDOWN_TRANSIENT_MS = 5 * 60_000;
/** Cooldown for faults that do not clear on their own: 404/410, a rejected key. */
const COOLDOWN_PERSISTENT_MS = 30 * 60_000;

/**
 * Default output budget.
 *
 * The configured model is a reasoning model: `max_tokens` covers
 * `reasoning_content` *and* the answer, and reasoning routinely consumes the
 * larger share. A budget sized for the answer alone truncates before the first
 * visible character — at 64 tokens this model produced zero content.
 */
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Per-model `chat_template_kwargs`.
 *
 * Hybrid-thinking models gate their reasoning behind a chat-template flag, and
 * the flag is *not* portable between them: NVIDIA's own snippets ask for
 * `{thinking, reasoning_effort}` on DeepSeek V4 Flash and `{enable_thinking}` on
 * Nemotron 3. Sending the wrong key fails silently — the template ignores it and
 * the model answers with no reasoning at all — so the mapping stays explicit per
 * model rather than one global shape that is wrong for half the chain.
 *
 * Matched on the model id with any vendor namespace stripped. The prefixes used
 * to carry one — `deepseek-ai/deepseek-v4-flash` — and the deployment we
 * actually point at serves the same model as `deepseek/deepseek-v4-flash`, so
 * every lookup missed and the whole table was dead config. A namespace is a
 * routing detail of the gateway, not part of the model's chat template.
 *
 * Suffixes still match by prefix, so a dated build ("…-0731") inherits its
 * family's entry. An unlisted model gets nothing, which is correct for a plain
 * instruct model.
 */
const CHAT_TEMPLATE_KWARGS: ReadonlyArray<
  readonly [prefix: string, kwargs: Record<string, unknown>]
> = [
  ["deepseek-v4-flash", { thinking: true }],
  ["nemotron-3", { enable_thinking: true }],
];

/**
 * Reasoning effort per tier.
 *
 * This was pinned to `"high"` for every call — routing a one-line question,
 * repairing a stray brace and planning a thirty-task backlog all paid the same
 * chain-of-thought. Reasoning is most of the token volume and it is emitted
 * *before* the first visible character, so effort is the dominant term in how
 * long the user stares at nothing. The strong tier is tunable with
 * `LLM_REASONING_EFFORT`; the fast tier is always low, which is the whole point
 * of it being a separate tier.
 */
const FAST_TIER_REASONING_EFFORT = "low";

/**
 * The strong tier's configured effort: the user's pick for this turn, then
 * `LLM_REASONING_EFFORT`. Undefined means neither was set.
 */
function configuredStrongEffort(): string | undefined {
  return currentUserReasoningEffort() ?? env.LLM_REASONING_EFFORT;
}

function strongTierReasoningEffort(): string {
  return configuredStrongEffort() ?? "medium";
}

/** The ladder `chat_template_kwargs.reasoning_effort` accepts. */
const TEMPLATE_EFFORT_LADDER = ["low", "medium", "high"] as const;

/**
 * Models that take reasoning effort as a **top-level** `reasoning_effort` field.
 *
 * A second, incompatible way of asking for the same thing. Kimi K3 dropped the
 * K2.x `chat_template_kwargs.thinking` flag entirely: reasoning is always on and
 * the only dial is `reasoning_effort` at the request root, with its own ladder —
 * `low` / `high` / `max`, defaulting to **`max`**.
 *
 * That default is why this table exists. {@link CHAT_TEMPLATE_KWARGS} matches
 * nothing for `kimi-k3`, so the client sent no effort at all and the provider
 * applied `max` to every call — routing a one-line question and repairing a
 * stray brace both paid the deepest chain-of-thought the model has, emitted
 * before the first visible character. The fast tier existed but bought nothing.
 *
 * Each family carries its own ladder *and* its own strong-tier default, because
 * the global default ("medium") is not a rung on K3's. Resolving it onto that
 * ladder would land on `low` and make the strong tier identical to the fast one,
 * quietly deleting the distinction the two tiers exist to draw.
 */
const REASONING_EFFORT_MODELS: ReadonlyArray<
  readonly [
    prefix: string,
    spec: { supported: readonly string[]; strongDefault: string },
  ]
> = [
  ["DeepSeek-V4-Flash", { supported: ["low", "medium", "high"], strongDefault: "medium" }],
  ["kimi-k3", { supported: ["low", "high", "max"], strongDefault: "high" }],
  // Measured on NVIDIA NIM: low 739ms / medium 1419ms / high 3099ms on the same
  // prompt, all returning the same answer. A full ladder, so the global default
  // needs no resolving here.
  [
    "gpt-oss",
    { supported: ["low", "medium", "high"], strongDefault: "medium" },
  ],
];

/**
 * Map an explicitly configured effort onto a ladder that may not contain it.
 *
 * Unsupported values resolve *downwards* — `medium` on a `low`/`high`/`max`
 * model becomes `low`. This dial exists to buy latency back, so the ambiguous
 * case should not silently cost more than was asked for. Only reached when
 * an effort was asked for — `LLM_REASONING_EFFORT`, the user's pick, or a
 * per-call override; an unset dial takes the family's own default
 * rather than being resolved from the global one.
 */
function nearestSupportedEffort(
  requested: string,
  supported: readonly string[],
): string {
  if (supported.includes(requested)) return requested;
  const ladder = ["low", "medium", "high", "max"];
  const wanted = ladder.indexOf(requested);
  if (wanted < 0) return supported[0]!;
  for (let i = wanted - 1; i >= 0; i--) {
    const candidate = ladder[i]!;
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0]!;
}

/** Top-level `reasoning_effort` for one request, or undefined if unsupported. */
function reasoningEffortFor(
  model: string,
  tier: "fast" | "strong",
  override?: string,
): string | undefined {
  const bare = model.slice(model.lastIndexOf("/") + 1);
  const spec = REASONING_EFFORT_MODELS.find(([prefix]) =>
    bare.startsWith(prefix),
  )?.[1];
  if (!spec) return undefined;
  // A per-request override is a deliberate choice by a caller that knows what
  // this particular call is for, so it outranks both the tier and the env dial —
  // still resolved onto the model's own ladder, like every other source.
  if (override) return nearestSupportedEffort(override, spec.supported);
  if (tier === "fast") {
    return nearestSupportedEffort(FAST_TIER_REASONING_EFFORT, spec.supported);
  }
  const configured = configuredStrongEffort();
  return configured
    ? nearestSupportedEffort(configured, spec.supported)
    : spec.strongDefault;
}

/**
 * The chat-template flags for one request: the model's family entry, plus the
 * reasoning effort for the tier it is being served on.
 *
 * Only models that take a `thinking` flag get an effort — `enable_thinking`
 * models have no effort dial, and sending them one is the same silent-ignore
 * mistake the per-model table exists to avoid.
 */
function chatTemplateKwargsFor(
  model: string,
  tier: "fast" | "strong",
  override?: string,
): Record<string, unknown> | undefined {
  const bare = model.slice(model.lastIndexOf("/") + 1);
  const kwargs = CHAT_TEMPLATE_KWARGS.find(([prefix]) =>
    bare.startsWith(prefix),
  )?.[1];
  if (!kwargs) return undefined;
  if (!("thinking" in kwargs)) return kwargs;
  // Resolved onto the template's ladder: the user can ask for "max", which no
  // template-flag model offers, and an unknown value is silently ignored there.
  return {
    ...kwargs,
    reasoning_effort: nearestSupportedEffort(
      override ??
        (tier === "fast"
          ? FAST_TIER_REASONING_EFFORT
          : strongTierReasoningEffort()),
      TEMPLATE_EFFORT_LADDER,
    ),
  };
}

/**
 * The effective config, recomputed per call.
 *
 * Cheap (a handful of string reads) and deliberately not memoised: the tests
 * swap provider variables between cases, and a cached first answer would have
 * every later case silently assert against the first one's endpoint.
 */
function config() {
  return resolveLlmConfig(env);
}

/** One model on one endpoint: the unit the chain retries, demotes and falls back over. */
interface Candidate {
  lane: "primary" | "backup";
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * One lane's models for a tier.
 *
 * The fast tier exists because conversation titles, rolling summaries, JSON
 * repair and intent classification are all short, mechanical, and were being
 * served by the same model that plans a thirty-task backlog. It falls back to
 * the strong chain when no fast model is set, so tiering is an optimisation and
 * never a hard dependency.
 */
function laneModels(lane: ResolvedLlmLane, tier: "fast" | "strong"): string[] {
  if (tier !== "fast" || !lane.fastModel) return lane.models;
  // Deduplicated: pointing LLM_MODEL_FAST at the same id as LLM_MODEL is the
  // normal configuration for a gateway that serves one model, and the naive
  // concatenation turned that into the same endpoint twice — a doubled retry
  // ladder (three attempts, then three more) against a model already known bad.
  return [lane.fastModel, ...lane.models.filter((m) => m !== lane.fastModel)];
}

/**
 * The chain for one request: primary lane, then backup lane, reordered by health.
 *
 * Pinning `req.model` names a model on the primary endpoint and skips the chain.
 */
function resolveCandidates(req: ChatRequest): Candidate[] {
  const cfg = config();
  const tier = req.tier ?? "strong";
  const primary = { lane: "primary" as const, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
  if (req.model) return [{ ...primary, model: req.model }];

  const chain: Candidate[] = laneModels(cfg, tier).map((model) => ({ ...primary, model }));
  if (cfg.backup) {
    const { baseUrl, apiKey } = cfg.backup;
    for (const model of laneModels(cfg.backup, tier)) {
      chain.push({ lane: "backup", baseUrl, apiKey, model });
    }
  }
  return orderByHealth(chain);
}

/** True when the AI features have enough configuration to run at all. */
export function isLlmConfigured(): boolean {
  const { baseUrl, apiKey, models } = config();
  return Boolean(baseUrl && apiKey && models.length > 0);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * When each recently failed candidate may lead the chain again, keyed by
 * endpoint and model.
 *
 * Per process and in memory on purpose. It is a latency optimisation, not a
 * source of truth: losing it on restart costs one slow request per dead model,
 * and sharing it across instances would need a store this layer has no reason to
 * depend on.
 */
const unhealthyUntil = new Map<string, number>();

function healthKey(c: Candidate): string {
  return `${c.baseUrl}|${c.model}`;
}

function markUnhealthy(c: Candidate, cooldownMs: number, reason: string): void {
  unhealthyUntil.set(healthKey(c), Date.now() + cooldownMs);
  log.warn("model demoted for a cooldown", {
    lane: c.lane,
    model: c.model,
    reason,
    cooldownMs,
  });
}

function markHealthy(c: Candidate): void {
  unhealthyUntil.delete(healthKey(c));
}

/**
 * Healthy candidates in configured order, then cooling ones, soonest to
 * recover first.
 *
 * Demoted rather than dropped. A cooldown is a guess about the next few minutes,
 * and if it is wrong for every candidate at once, trying them all late is still
 * better than failing without trying.
 */
function orderByHealth(chain: Candidate[]): Candidate[] {
  const now = Date.now();
  const until = (c: Candidate) => unhealthyUntil.get(healthKey(c)) ?? 0;
  const healthy = chain.filter((c) => until(c) <= now);
  const cooling = chain
    .filter((c) => until(c) > now)
    .sort((a, b) => until(a) - until(b));
  return [...healthy, ...cooling];
}

/** Forget every cooldown. For tests, which share this module across cases. */
export function resetLlmHealth(): void {
  unhealthyUntil.clear();
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
  /**
   * Which model chain to use. "fast" prefers `LLM_MODEL_FAST` for short,
   * mechanical work; omit (or "strong") for planning and analysis. Ignored when
   * `model` pins one explicitly.
   */
  tier?: "fast" | "strong";
  /**
   * Chain-of-thought budget for this one call, overriding the tier, the user's
   * pick for the turn (`effortScope.ts`) and `LLM_REASONING_EFFORT`.
   *
   * For callers that know a particular call does not need the depth the tier
   * implies — picking which tools to fetch is not the same work as reasoning
   * over what they returned. Resolved onto the model's own ladder, so a value it
   * does not offer lands on the nearest cheaper rung rather than being rejected.
   */
  reasoningEffort?: "low" | "medium" | "high" | "max";
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

/**
 * The request ran out of time.
 *
 * `name` is set explicitly because {@link isRetriable} classifies on it, and an
 * `AbortController` aborted with `new Error("TimeoutError")` yields an error
 * whose name is plain `"Error"` — the message says "TimeoutError" but nothing
 * reads the message, so such a timeout was silently treated as non-retriable.
 *
 * `phase` distinguishes "the endpoint never answered" from "generation ran long",
 * which are different faults with different fixes.
 */
export class LlmTimeoutError extends Error {
  readonly phase: "first-byte" | "total";
  readonly waitedMs: number;

  constructor(phase: "first-byte" | "total", waitedMs: number) {
    super(
      phase === "first-byte"
        ? `LLM sent no response headers within ${String(waitedMs)}ms — the endpoint accepted the request but is not serving it`
        : `LLM request exceeded its ${String(waitedMs)}ms budget`,
    );
    this.name = "TimeoutError";
    this.phase = phase;
    this.waitedMs = waitedMs;
  }
}

/**
 * Every candidate in the chain failed.
 *
 * The message is written for the person waiting on the answer, because it is
 * the one they see: the chat route forwards `err.message` as-is, and the
 * upstream error it replaces read like "LLM request failed (504): <html>…".
 * The upstream failure stays on `cause` for the logs. `code` lets a client
 * swap in a localised string.
 */
export class LlmUnavailableError extends Error {
  readonly code = "AI_UNAVAILABLE";
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      "The AI assistant is temporarily unavailable. Please try again in a few minutes.",
    );
    this.name = "LlmUnavailableError";
    this.cause = cause;
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

  const templateKwargs = chatTemplateKwargsFor(
    model,
    req.tier ?? "strong",
    req.reasoningEffort,
  );
  if (templateKwargs) {
    // Top level, not nested: the OpenAI SDK's `extra_body` merges its keys into
    // the request root, and that is the shape the NIM reads off the wire.
    body.chat_template_kwargs = templateKwargs;
  }

  const reasoningEffort = reasoningEffortFor(
    model,
    req.tier ?? "strong",
    req.reasoningEffort,
  );
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

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

/** Errors no other candidate can fix, so the chain stops and rethrows. */
function isFatalForRequest(err: unknown): boolean {
  // Truncation says the request was too big for the budget, not that the endpoint
  // is unhealthy; the caller retries with a larger budget instead.
  if (err instanceof TruncatedResponseError) return true;
  // The caller hung up. Nobody is waiting for a fallback answer.
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

/**
 * Errors that doom every model *on the same endpoint* equally.
 *
 * A malformed request or a bad key fails identically on that gateway's fallback
 * model, so trying it only doubles the user's wait. A different provider is
 * another matter: it has its own key, and its own idea of which parameters and
 * context lengths it accepts, so the backup lane is still worth a try.
 *
 * Everything else — a timeout, a 404 for a model this account cannot reach, an
 * upstream 5xx — is a property of *that model*, and the next model exists
 * precisely for it. This distinction is why a stalled primary used to surface as
 * a 500 with the fallback never attempted: the chain threw on the first
 * non-retriable error instead of advancing.
 */
function isFatalForLane(err: unknown): boolean {
  return (
    err instanceof LlmHttpError &&
    (err.status === 400 || err.status === 401 || err.status === 403)
  );
}

/**
 * A 429 that backing off will not clear.
 *
 * 429 covers two unlike failures. A burst limit clears in a moment and the
 * provider says so with `Retry-After`; a per-account quota does not clear within
 * any backoff this client is willing to wait, and providers signal that by
 * sending no `Retry-After` at all.
 *
 * Retrying the second kind costs the full ladder — three attempts capped at 8s,
 * then the same again on the fallback model — before advancing to a model that
 * could have been tried immediately. Measured against NVIDIA's free NIM gateway
 * under quota exhaustion, that was ~40s of sleeping per model call, on a tool
 * loop that may make eight of them.
 *
 * So: honour `Retry-After` when it is offered, and treat its absence on a 429 as
 * "this endpoint is done for now" — the same reasoning as the first-byte rule,
 * which also trades a doomed retry for an immediate move down the chain.
 */
function isQuotaExhausted(err: unknown): boolean {
  return (
    err instanceof LlmHttpError &&
    err.status === 429 &&
    err.retryAfterMs === undefined
  );
}

function isRetriable(err: unknown): boolean {
  if (err instanceof LlmHttpError) return RETRIABLE_STATUS.has(err.status);
  if (err instanceof TruncatedResponseError) return false;
  if (err instanceof Error) {
    // `LlmTimeoutError` sets name = "TimeoutError", as does the DOMException from
    // `AbortSignal.timeout`; fetch raises TypeError on a dropped connection or
    // DNS failure. All are worth one more attempt.
    if (err.name === "TimeoutError") return true;
    if (err.name === "TypeError") return true;
  }
  return false;
}

/**
 * What to do after one failed attempt, and how long to demote the candidate.
 *
 * `cooldownMs` is set only for faults the *next request* would hit too. A 400
 * says this request is wrong, not that the model is, so it demotes nothing.
 */
type Verdict =
  | { action: "throw" }
  | { action: "retry"; waitMs: number }
  | { action: "next-model" | "next-lane"; reason: string; cooldownMs?: number };

function verdictFor(err: unknown, attempt: number): Verdict {
  if (isFatalForRequest(err)) return { action: "throw" };

  if (isFatalForLane(err)) {
    const status = (err as LlmHttpError).status;
    return status === 400
      ? { action: "next-lane", reason: "request rejected (400)" }
      : {
          action: "next-lane",
          reason: `key rejected (${String(status)})`,
          cooldownMs: COOLDOWN_PERSISTENT_MS,
        };
  }

  if (err instanceof LlmHttpError && (err.status === 404 || err.status === 410)) {
    // Gone or never served to this account. NIM lists models it will not serve.
    return {
      action: "next-model",
      reason: `model unavailable (${String(err.status)})`,
      cooldownMs: COOLDOWN_PERSISTENT_MS,
    };
  }

  // Not worth a second shot at the same endpoint, but no sign it is unhealthy.
  if (!isRetriable(err)) return { action: "next-model", reason: "not retriable" };

  // Either the gateway never sent a byte, which it will not do on attempt two,
  // or generation already ran the whole budget. Repeating either costs minutes.
  if (err instanceof LlmTimeoutError) {
    return {
      action: "next-model",
      reason: `timeout (${err.phase})`,
      cooldownMs: COOLDOWN_TRANSIENT_MS,
    };
  }

  if (isQuotaExhausted(err)) {
    return {
      action: "next-model",
      reason: "quota exhausted (429)",
      cooldownMs: COOLDOWN_TRANSIENT_MS,
    };
  }

  if (attempt >= MAX_ATTEMPTS_PER_MODEL - 1) {
    return {
      action: "next-model",
      reason: "retries exhausted",
      cooldownMs: COOLDOWN_TRANSIENT_MS,
    };
  }

  return {
    action: "retry",
    waitMs:
      err instanceof LlmHttpError && err.retryAfterMs !== undefined
        ? err.retryAfterMs
        : backoffMs(attempt),
  };
}

/**
 * Apply a verdict: throw, sleep and say "retry", or record the demotion and say
 * "advance". `skipLanes` collects lanes that a lane-fatal error has ruled out
 * for the rest of this request.
 */
async function handleFailure(
  err: unknown,
  candidate: Candidate,
  attempt: number,
  req: ChatRequest,
  skipLanes: Set<Candidate["lane"]>,
): Promise<"retry" | "advance"> {
  const verdict = verdictFor(err, attempt);
  if (verdict.action === "throw") throw err;

  if (verdict.action === "retry") {
    log.warn("retriable LLM failure, backing off", {
      lane: candidate.lane,
      model: candidate.model,
      attempt: attempt + 1,
      waitMs: verdict.waitMs,
      err,
    });
    await sleep(verdict.waitMs, req.signal);
    return "retry";
  }

  if (verdict.cooldownMs !== undefined) {
    markUnhealthy(candidate, verdict.cooldownMs, verdict.reason);
  }
  if (verdict.action === "next-lane") skipLanes.add(candidate.lane);
  log.warn("advancing the chain", {
    lane: candidate.lane,
    model: candidate.model,
    reason: verdict.reason,
    err,
  });
  return "advance";
}

/**
 * The error to raise once the chain is exhausted.
 *
 * A 400 is a bug in the request rather than an outage, so it surfaces as itself
 * where it can be fixed. Everything else becomes {@link LlmUnavailableError}.
 */
function chainExhausted(lastError: unknown): Error {
  if (lastError instanceof LlmHttpError && lastError.status === 400) return lastError;
  log.error("every LLM candidate failed", { err: lastError });
  return new LlmUnavailableError(lastError);
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
 * Combine the caller's signal with a total budget and a first-byte budget.
 *
 * `AbortSignal.any` is not available on every Node version this runs on, so wire
 * it manually and hand back a disposer to avoid leaking listeners.
 *
 * Call {@link Deadlines.firstByteReceived} as soon as response headers arrive.
 * That cancels the short first-byte guard and leaves only the total budget, so a
 * slow *answer* is never mistaken for a dead *endpoint*.
 */
interface Deadlines {
  signal: AbortSignal;
  firstByteReceived: () => void;
  dispose: () => void;
}

function withTimeout(
  timeoutMs: number,
  external?: AbortSignal,
  firstByteMs = FIRST_BYTE_TIMEOUT_MS,
): Deadlines {
  const controller = new AbortController();
  const total = setTimeout(
    () => controller.abort(new LlmTimeoutError("total", timeoutMs)),
    timeoutMs,
  );
  // Never let the first-byte guard outlive the total budget it sits inside.
  const firstByteBudget = Math.min(firstByteMs, timeoutMs);
  let firstByte: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(new LlmTimeoutError("first-byte", firstByteBudget)),
    firstByteBudget,
  );

  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    firstByteReceived: () => {
      if (firstByte !== undefined) {
        clearTimeout(firstByte);
        firstByte = undefined;
      }
    },
    dispose: () => {
      clearTimeout(total);
      if (firstByte !== undefined) clearTimeout(firstByte);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function assertConfigured(): void {
  const { provider, baseUrl, apiKey, models } = config();
  // Naming the provider-specific variable matters: with a preset selected, the
  // key the app read is LLM_API_KEY_<PROVIDER>, and a message pointing at plain
  // LLM_API_KEY sends you to edit a line that is already correct.
  const keyVar = provider
    ? `LLM_API_KEY_${provider.toUpperCase()} (or LLM_API_KEY)`
    : "LLM_API_KEY";
  if (!apiKey) {
    log.error(`${keyVar} is not set — every AI feature will fail`);
    throw new Error(
      `${keyVar} is not set. Add your provider key to .env (see .env.example).`,
    );
  }
  if (!baseUrl) {
    throw new Error(
      "LLM_BASE_URL is not set, and no LLM_PROVIDER preset supplied one. Add either to .env (see .env.example).",
    );
  }
  if (models.length === 0) {
    throw new Error(
      "LLM_MODEL is not set, and no LLM_PROVIDER preset supplied one. Add either to .env (see .env.example).",
    );
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

/** One POST to one candidate. Shared by both paths so headers stay in one place. */
function postCompletion(
  candidate: Candidate,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${candidate.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${candidate.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
}

/** Read a plain JSON completion: a gateway that ignored `stream: true`. */
async function readJsonCompletion(
  res: Response,
  model: string,
  startedAt: number,
  purpose?: string,
): Promise<ChatResponse> {
  const data = (await res.json()) as WireCompletion;
  const choice = data.choices?.[0];
  if (!choice?.message) throw new Error("LLM returned no choices");

  const toolCalls = readToolCalls(choice.message.tool_calls);
  const finishReason = choice.finish_reason ?? null;
  const usage = readUsage(data.usage);

  log.info("completion", {
    purpose: purpose ?? "unspecified",
    model: data.model ?? model,
    latencyMs: Date.now() - startedAt,
    finishReason,
    toolCalls: toolCalls.length,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    cachedPromptTokens: usage?.cachedPromptTokens,
  });

  return {
    content: choice.message.content ?? "",
    reasoning: choice.message.reasoning_content ?? undefined,
    toolCalls,
    finishReason,
    model: data.model ?? model,
    usage,
  };
}

/**
 * One attempt against one candidate, streamed on the wire and assembled here.
 *
 * Streaming is for the first-byte guard (see {@link FIRST_BYTE_TIMEOUT_MS}), not
 * for the caller, who still gets one whole response. Because nothing has been
 * shown to anyone yet, a failure mid-stream is as retriable as one before it,
 * unlike in {@link streamCompletion}.
 */
async function singleCompletion(
  req: ChatRequest,
  candidate: Candidate,
): Promise<ChatResponse> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, firstByteReceived, dispose } = withTimeout(timeoutMs, req.signal);
  const startedAt = Date.now();

  try {
    const res = await postCompletion(candidate, buildBody(req, candidate.model, true), signal);
    // Headers are in, so the endpoint is alive; the rest of the wait is
    // generation and belongs to the total budget alone.
    firstByteReceived();

    if (!res.ok) throw await toHttpError(res);

    let response: ChatResponse | undefined;
    const isJson = res.headers.get("content-type")?.includes("application/json");
    if (isJson || !res.body) {
      response = await readJsonCompletion(res, candidate.model, startedAt, req.purpose);
    } else {
      for await (const event of readStream(res.body, candidate.model, startedAt, req.purpose)) {
        if (event.type !== "done") continue;
        response = {
          content: event.content,
          reasoning: event.reasoning || undefined,
          toolCalls: event.toolCalls,
          finishReason: event.finishReason,
          model: event.model,
          usage: event.usage,
        };
      }
    }
    if (!response) throw new Error("LLM stream ended without a result");

    // Truncation is only a failure when the model was producing an answer. A
    // tool-calling turn that stops at the cap still yields usable calls.
    if (response.finishReason === "length" && response.toolCalls.length === 0) {
      throw new TruncatedResponseError(
        response.content,
        req.maxTokens ?? DEFAULT_MAX_TOKENS,
      );
    }
    return response;
  } finally {
    dispose();
  }
}

/**
 * Send a chat completion, retrying transient failures and failing over down the
 * chain: primary models, then the backup provider's. See the module comment.
 *
 * Pinning `req.model` skips the chain and uses only that model.
 */
export async function chatCompletion(req: ChatRequest): Promise<ChatResponse> {
  assertConfigured();

  const skipLanes = new Set<Candidate["lane"]>();
  let lastError: unknown;

  for (const candidate of resolveCandidates(req)) {
    if (skipLanes.has(candidate.lane)) continue;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const response = await singleCompletion(req, candidate);
        markHealthy(candidate);
        return response;
      } catch (err) {
        lastError = err;
        const next = await handleFailure(err, candidate, attempt, req, skipLanes);
        if (next === "advance") break;
      }
    }
  }

  throw chainExhausted(lastError);
}

/** Send a system + user prompt and get the text back. */
export async function simpleCompletion(
  systemPrompt: string,
  userMessage: string,
  opts?: {
    model?: string;
    /** Which model chain to use. Short, mechanical prompts belong on "fast". */
    tier?: "fast" | "strong";
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
    tier: opts?.tier,
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

  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const skipLanes = new Set<Candidate["lane"]>();
  let lastError: unknown;

  for (const candidate of resolveCandidates(req)) {
    if (skipLanes.has(candidate.lane)) continue;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const { signal, firstByteReceived, dispose } = withTimeout(timeoutMs, req.signal);
      const startedAt = Date.now();

      let res: Response;
      try {
        res = await postCompletion(candidate, buildBody(req, candidate.model, true), signal);
        // Headers are in — from here the stream owns the total budget.
        firstByteReceived();
        if (!res.ok) throw await toHttpError(res);
        if (!res.body) throw new Error("LLM returned no response body");
      } catch (err) {
        dispose();
        lastError = err;
        const next = await handleFailure(err, candidate, attempt, req, skipLanes);
        if (next === "advance") break;
        continue;
      }

      // Past this point the response is committed: surface failures rather than
      // restarting and double-rendering.
      markHealthy(candidate);
      try {
        yield* readStream(res.body, candidate.model, startedAt, req.purpose);
        return;
      } finally {
        dispose();
      }
    }
  }

  throw chainExhausted(lastError);
}

/**
 * The longest prefix of `tag` that appears as a suffix of `text`.
 *
 * Used to detect a tag boundary split across two SSE frames: if the current
 * chunk ends with `<thi`, we cannot conclude `<think>` is absent — it may
 * start on the boundary. Returning `n > 0` tells the caller to hold back
 * the last `n` characters until the next frame confirms or denies the tag.
 */
function partialTagLength(text: string, tag: string): number {
  const maxLen = Math.min(text.length, tag.length - 1);
  for (let len = maxLen; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
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
  /** True while we are inside a <think>…</think> block in the content stream. */
  let inThinkBlock = false;
  /** Holds a partial tag boundary that arrived split across two frames. */
  let thinkBuffer = "";

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
          // Some gateways embed chain-of-thought in <think>…</think> within
          // the content field rather than a separate reasoning_content field.
          // Parse them out so reasoning tokens never reach the chat transcript.
          let chunk = thinkBuffer + delta.content;
          thinkBuffer = "";
          const pending: Array<{ isReasoning: boolean; text: string }> = [];

          while (chunk.length > 0) {
            if (inThinkBlock) {
              const closeIdx = chunk.indexOf("</think>");
              if (closeIdx >= 0) {
                if (closeIdx > 0)
                  pending.push({ isReasoning: true, text: chunk.slice(0, closeIdx) });
                chunk = chunk.slice(closeIdx + 8);
                inThinkBlock = false;
              } else {
                const partial = partialTagLength(chunk, "</think>");
                pending.push({ isReasoning: true, text: chunk.slice(0, chunk.length - partial) });
                thinkBuffer = chunk.slice(chunk.length - partial);
                break;
              }
            } else {
              const openIdx = chunk.indexOf("<think>");
              if (openIdx >= 0) {
                if (openIdx > 0)
                  pending.push({ isReasoning: false, text: chunk.slice(0, openIdx) });
                chunk = chunk.slice(openIdx + 7);
                inThinkBlock = true;
              } else {
                const partial = partialTagLength(chunk, "<think>");
                pending.push({ isReasoning: false, text: chunk.slice(0, chunk.length - partial) });
                thinkBuffer = chunk.slice(chunk.length - partial);
                break;
              }
            }
          }

          for (const ev of pending) {
            if (ev.isReasoning) {
              reasoning += ev.text;
              yield { type: "reasoning", text: ev.text };
            } else {
              content += ev.text;
              yield { type: "content", text: ev.text };
            }
          }
        }
        toolCalls.push(delta.tool_calls);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // A stream that ends inside or mid-tag: treat leftover buffer as content.
  if (thinkBuffer) content += thinkBuffer;

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
