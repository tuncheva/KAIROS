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

/**
 * Must equal the width of the `embedding` columns, which migration
 * 0049_embedding_halfvec_2048 sets to `halfvec(2048)` — the only width
 * nvidia/nemotron-3-embed-1b emits.
 *
 * pgvector fixes the dimension at the column, so a mismatch is not degraded
 * results — it is a Postgres error on insert. Changing this means changing the
 * columns and rebuilding their HNSW indexes in the same migration.
 */
const DEFAULT_EMBEDDING_DIMS = 2048;

/**
 * What a text is being embedded as. Asymmetric retrieval models embed a short
 * question and the passage that answers it differently, and must be told which
 * is which: sent without `input_type`, nemotron-3-embed-1b ranked the right
 * passage first for 1 of 7 Bulgarian queries in our probe, and with it 7 of 7.
 */
export type EmbeddingPurpose = "query" | "passage";

function getEmbeddingConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
  dims: number;
  sendInputType: boolean;
} | null {
  const model = env.LLM_EMBEDDING_MODEL;
  if (!model) return null;

  // Embedding-specific overrides take priority; fall back to the main LLM config
  // so that providers which serve both chat and embeddings only need one set of vars.
  const resolved = resolveLlmConfig(env);
  const baseUrl = (env.LLM_EMBEDDING_BASE_URL ?? resolved.baseUrl).replace(/\/$/, "");
  const apiKey = env.LLM_EMBEDDING_API_KEY ?? resolved.apiKey;

  if (!baseUrl || !apiKey) return null;
  const dims = Number(env.LLM_EMBEDDING_DIMS ?? String(DEFAULT_EMBEDDING_DIMS));
  return {
    baseUrl,
    apiKey,
    model,
    dims: Number.isInteger(dims) && dims > 0 ? dims : DEFAULT_EMBEDDING_DIMS,
    // Off by default: `input_type` is an NVIDIA/Cohere extension, and a strictly
    // OpenAI-compatible endpoint may reject the unknown field.
    sendInputType: env.LLM_EMBEDDING_INPUT_TYPE === "true",
  };
}

/** True when the embedding endpoint is configured. */
export function isEmbeddingConfigured(): boolean {
  return getEmbeddingConfig() !== null;
}

/** The embedding dimension, for schema alignment. */
export function embeddingDims(): number {
  return getEmbeddingConfig()?.dims ?? DEFAULT_EMBEDDING_DIMS;
}

/** Characters of each input sent. Stays within typical model context limits. */
const MAX_INPUT_CHARS = 8000;

/**
 * Embed several texts in one request.
 *
 * Returns one vector per input, in input order, or null for the whole batch when
 * embedding is not configured or the call fails. All-or-nothing on purpose: the
 * callers are sweeps that retry every NULL row on the next tick, so a partial
 * result would only add bookkeeping without saving a request.
 *
 * A vector whose width is not `dims` is treated as a failure rather than handed
 * on. The columns are `halfvec(2048)`: written, it is a Postgres error on insert;
 * used as a query, it makes the `<=>` comparison throw and takes keyword search
 * down with it, because both run in the same tool call.
 */
export async function embedTexts(
  texts: string[],
  purpose: EmbeddingPurpose,
): Promise<number[][] | null> {
  const cfg = getEmbeddingConfig();
  if (!cfg || texts.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        input: texts.map((t) => t.slice(0, MAX_INPUT_CHARS)),
        ...(cfg.sendInputType ? { input_type: purpose } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn("embedding request failed", { status: response.status, batch: texts.length });
      return null;
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const items = data.data ?? [];
    if (items.length !== texts.length) {
      log.warn("embedding response size mismatch", { expected: texts.length, got: items.length });
      return null;
    }

    // The spec returns `index` per item; order by it rather than trusting the array order.
    const ordered = [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors: number[][] = [];
    for (const item of ordered) {
      const v = item.embedding;
      if (!Array.isArray(v) || v.length !== cfg.dims) {
        log.warn("embedding has unexpected width", { expected: cfg.dims, got: v?.length ?? 0 });
        return null;
      }
      vectors.push(v);
    }
    return vectors;
  } catch (err) {
    log.warn("embedding error", { err });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embed one piece of text.
 *
 * Returns null when embedding is not configured or the call fails — callers
 * treat null as "fall back to keyword search", so a transient failure does not
 * break search entirely.
 */
export async function embedText(
  text: string,
  purpose: EmbeddingPurpose,
): Promise<number[] | null> {
  const vectors = await embedTexts([text], purpose);
  return vectors?.[0] ?? null;
}

/** Serialize an embedding for pgvector's `vector`/`halfvec` input: '[0.1,0.2,...]' */
export function serializeEmbedding(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
