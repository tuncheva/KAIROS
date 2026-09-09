/**
 * Text embedding — vector representation for semantic search.
 *
 * Uses an OpenAI-compatible /embeddings endpoint. Gated on LLM_EMBEDDING_MODEL
 * being set: if it is not, every call returns null, which is the signal to fall
 * back to keyword search. That keeps embedding search an additive feature rather
 * than a hard dependency.
 *
 * Endpoint resolution, highest-priority first:
 *   1. LLM_EMBEDDING_BASE_URL + LLM_EMBEDDING_API_KEY — a dedicated embedding
 *      provider (e.g. OpenAI for embeddings while another gateway handles chat).
 *   2. The resolved LLM config (LLM_PROVIDER preset or LLM_BASE_URL / LLM_API_KEY)
 *      — works when the same gateway serves both chat and embeddings.
 *
 * This lets the project use, say, Velocity for chat completions and OpenAI's
 * text-embedding-3-small for semantic search, with one extra env var each.
 */
import "server-only";

import { env } from "~/env";
import { createLogger } from "~/server/logger";
import { resolveLlmConfig } from "./providers";

const log = createLogger("llm.embed");

const TIMEOUT_MS = 15_000;

function getEmbeddingConfig(): { baseUrl: string; apiKey: string; model: string; dims: number } | null {
  const model = env.LLM_EMBEDDING_MODEL;
  if (!model) return null;

  // Embedding-specific overrides take priority; fall back to the main LLM config
  // so that providers which serve both chat and embeddings only need one set of vars.
  const resolved = resolveLlmConfig(env);
  const baseUrl = (env.LLM_EMBEDDING_BASE_URL ?? resolved.baseUrl).replace(/\/$/, "");
  const apiKey = env.LLM_EMBEDDING_API_KEY ?? resolved.apiKey;

  if (!baseUrl || !apiKey) return null;
  const dims = Number(env.LLM_EMBEDDING_DIMS ?? "1536");
  return { baseUrl, apiKey, model, dims: Number.isInteger(dims) && dims > 0 ? dims : 1536 };
}

/** True when the embedding endpoint is configured. */
export function isEmbeddingConfigured(): boolean {
  return getEmbeddingConfig() !== null;
}

/** The embedding dimension, for schema alignment. Defaults to 1536. */
export function embeddingDims(): number {
  return getEmbeddingConfig()?.dims ?? 1536;
}

/**
 * Embed one piece of text.
 *
 * Returns null when embedding is not configured or the call fails — callers
 * treat null as "fall back to keyword search", so a transient failure does not
 * break search entirely.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const cfg = getEmbeddingConfig();
  if (!cfg) return null;

  const truncated = text.slice(0, 8000); // stay within typical context limits
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: cfg.model, input: truncated }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn("embedding request failed", { status: response.status });
      return null;
    }

    const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) return null;
    return embedding;
  } catch (err) {
    log.warn("embedding error", { err });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Serialize an embedding for Postgres pgvector: '[0.1,0.2,...]' */
export function serializeEmbedding(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
