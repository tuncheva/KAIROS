/**
 * LLM Model Client — uses HuggingFace Inference Providers (OpenAI-compatible).
 *
 * No `openai` npm package required — uses raw `fetch` against the
 * OpenAI-compatible chat completions endpoint.
 *
 * Model fallback chain:
 *   1. Primary:   meta-llama/Llama-3.1-8B-Instruct  (LLM_DEFAULT_MODEL)
 *   2. Fallback:  meta-llama/Llama-3.2-3B-Instruct  (LLM_FALLBACK_MODEL)
 *   3. Alternate:  Qwen/Qwen2.5-7B-Instruct          (LLM_ALTERNATE_MODEL)
 *
 * On 429 (rate limit), 503 (service unavailable), or timeout the client
 * automatically retries with the next model in the chain.
 *
 * Env vars (see docs/agent-env-vars.md):
 *   LLM_BASE_URL        — e.g. https://router.huggingface.co/v1
 *   LLM_API_KEY          — HuggingFace token with inference.serverless.write
 *   LLM_DEFAULT_MODEL    — primary model
 *   LLM_FALLBACK_MODEL   — fallback model
 *   LLM_ALTERNATE_MODEL  — alternate model (third tier)
 */

import "server-only";

import { createLogger } from "~/server/logger";

const log = createLogger("llm");

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  return (
    process.env.LLM_BASE_URL ??
    "https://router.huggingface.co/v1"
  );
}

function getApiKey(): string {
  return (
    process.env.LLM_API_KEY ??
    ""
  );
}

function getDefaultModel(): string {
  return (
    process.env.LLM_DEFAULT_MODEL ??
    "meta-llama/Llama-3.1-8B-Instruct"
  );
}

function getFallbackModel(): string {
  return (
    process.env.LLM_FALLBACK_MODEL ??
    "meta-llama/Llama-3.2-3B-Instruct"
  );
}

function getAlternateModel(): string {
  return (
    process.env.LLM_ALTERNATE_MODEL ??
    "Qwen/Qwen2.5-7B-Instruct"
  );
}

/** Returns the ordered fallback chain: primary → fallback → alternate. */
function getModelChain(): string[] {
  return [getDefaultModel(), getFallbackModel(), getAlternateModel()];
}

/** HTTP status codes that trigger an automatic fallback to the next model. */
const RETRIABLE_STATUS_CODES = new Set([429, 503]);

// ---------------------------------------------------------------------------
// Types for the OpenAI-compatible response
// ---------------------------------------------------------------------------

interface HFChatChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
  };
  finish_reason: string | null;
}

interface HFChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface HFChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: HFChatChoice[];
  usage?: HFChatUsage;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChatRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** If true, request the model to return JSON (response_format: json_object) */
  jsonMode?: boolean;
}

export interface ChatResponse {
  content: string;
  finishReason: string | null;
  /** The model that actually served this request (may differ from the requested model after fallback). */
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Fire a single completion request for the given model. Does NOT retry or
 * fall back — callers should handle retriable errors themselves.
 */
async function singleCompletion(
  req: ChatRequest,
  model: string,
): Promise<ChatResponse> {
  const baseUrl = getBaseUrl().replace(/\/+$/, "");
  const apiKey = getApiKey();

  if (!apiKey) {
    log.error("LLM_API_KEY is not set; AI features are disabled");
    throw new Error(
      "LLM_API_KEY is not set. Please add your HuggingFace token to .env",
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 4096,
  };

  if (req.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `LLM request failed (${String(res.status)}): ${text.slice(0, 500)}`,
    );
    (err as NodeJS.ErrnoException).code = String(res.status);
    throw err;
  }

  const data = (await res.json()) as HFChatCompletionResponse;
  const choice = data.choices[0];

  if (!choice) {
    throw new Error("LLM returned no choices");
  }

  return {
    content: choice.message.content ?? "",
    finishReason: choice.finish_reason,
    model: data.model ?? model,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

/** Returns `true` when the error looks retriable (429, 503, or timeout). */
function isRetriable(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && RETRIABLE_STATUS_CODES.has(Number(code))) return true;
    // AbortSignal.timeout throws a DOMException with name "TimeoutError"
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  }
  return false;
}

/**
 * Send a chat completion request with automatic model fallback.
 *
 * If `req.model` is explicitly provided the fallback chain is skipped and only
 * that model is used. Otherwise the default chain (primary → fallback →
 * alternate) is tried in order.
 */
export async function chatCompletion(req: ChatRequest): Promise<ChatResponse> {
  // When the caller pins a specific model, don't fall back.
  if (req.model) {
    return singleCompletion(req, req.model);
  }

  const chain = getModelChain();
  let lastError: unknown;

  for (const model of chain) {
    try {
      return await singleCompletion(req, model);
    } catch (err) {
      lastError = err;
      if (!isRetriable(err)) throw err; // non-retriable → fail immediately
      log.warn("model failed with a retriable error, falling back", { model, err });
    }
  }

  // All models exhausted
  if (lastError instanceof Error) throw lastError;
  throw new Error(
    typeof lastError === "string"
      ? lastError
      : "All models in the fallback chain failed",
  );
}

/**
 * Send a simple prompt and get a string response.
 */
export async function simpleCompletion(
  systemPrompt: string,
  userMessage: string,
  opts?: { model?: string; temperature?: number; jsonMode?: boolean },
): Promise<string> {
  const res = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    model: opts?.model,
    temperature: opts?.temperature,
    jsonMode: opts?.jsonMode,
  });
  return res.content;
}
