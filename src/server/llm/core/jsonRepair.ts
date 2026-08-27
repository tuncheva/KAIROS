/**
 * Getting schema-valid JSON out of the model.
 *
 * The endpoint accepts `response_format: json_object` but not `json_schema`, so
 * nothing upstream guarantees the *shape* — only that the output parses. This
 * module closes that gap: extract, parse, validate against Zod, and on failure
 * ask the model to repair its own output.
 *
 * Two rules learned the hard way:
 *
 * - **Never repair truncated output.** A response cut off at `max_tokens` is
 *   incomplete, not malformed; asking a model to "fix" half an object invents
 *   the missing half. {@link completeJson} retries with a bigger budget instead.
 * - **Every repair is a billed call.** They used to be invisible to the rate
 *   limiter, so a 50/day budget could cost 150 upstream. Pass `userId` and they
 *   are recorded.
 */

import type { z } from "zod";

import {
  chatCompletion,
  simpleCompletion,
  TruncatedResponseError,
  type ChatMessage,
} from "./modelClient";
import { recordExtraAiCall } from "~/server/security/rateLimit";
import { createLogger } from "~/server/logger";

const log = createLogger("llm.json");

const MAX_REPAIRS = 2;

/** How much bigger the second attempt gets after a truncated first attempt. */
const TRUNCATION_RETRY_MULTIPLIER = 2;
const MAX_RETRY_TOKENS = 16_384;

/**
 * Extract a JSON value from text that may carry markdown fences or commentary.
 *
 * The brace scan is string-aware. Counting braces blindly meant a `{` inside any
 * string value — a task description, a note body — decremented the depth early
 * and returned a truncated slice that could never parse.
 */
export function extractJson(raw: string): string {
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
  const fenceMatch = fenceRegex.exec(raw);
  const text = fenceMatch?.[1]?.trim() ?? raw;

  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  if (firstBrace === -1 && firstBracket === -1) return text.trim();

  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);

  const openChar = text[start] === "{" ? "{" : "[";
  const closeChar = openChar === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      // Only meaningful inside a string, but harmless outside one.
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unbalanced: hand back everything from the opening delimiter and let the
  // caller's parse failure carry the real error message.
  return text.slice(start);
}

export interface ParseResult<T> {
  success: true;
  data: T;
  repairCount: number;
}

export interface ParseError {
  success: false;
  error: string;
  repairCount: number;
}

/**
 * Parse and validate a raw model response against a Zod schema, repairing up to
 * {@link MAX_REPAIRS} times.
 */
export async function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts?: { model?: string; userId?: string; signal?: AbortSignal },
): Promise<ParseResult<T> | ParseError> {
  let repairCount = 0;
  let current = raw;

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    try {
      const parsed = JSON.parse(extractJson(current)) as unknown;
      return { success: true, data: schema.parse(parsed), repairCount };
    } catch (err) {
      if (attempt === MAX_REPAIRS) {
        return {
          success: false,
          error:
            err instanceof Error ? err.message : "Unknown parse/validation error",
          repairCount,
        };
      }

      repairCount++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.debug("repairing model JSON", { attempt: repairCount, error: errorMsg });

      try {
        if (opts?.userId) await recordExtraAiCall(opts.userId);
        current = await simpleCompletion(
          "You are a JSON repair assistant. The user will give you an invalid JSON string and the error. Return ONLY the corrected valid JSON — no explanations, no fences, no extra text.",
          `Original:\n${current}\n\nError:\n${errorMsg}`,
          {
            model: opts?.model,
            // Short, mechanical, and on the critical path: the answer has
            // already streamed and the user is waiting on this before the turn
            // resolves. `modelClient` names JSON repair as fast-tier work; it
            // simply was never asked for one, so a stray brace cost a full
            // reasoning pass.
            tier: "fast",
            temperature: 0,
            jsonMode: true,
            signal: opts?.signal,
            purpose: "jsonRepair",
          },
        );
      } catch {
        return { success: false, error: "Repair prompt failed", repairCount };
      }
    }
  }

  return { success: false, error: "Exhausted repair attempts", repairCount };
}

export interface CompleteJsonOptions<T> {
  messages: ChatMessage[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  temperature?: number;
  maxTokens?: number;
  /** Label for the model-client log line, e.g. "a2.draft". */
  purpose?: string;
  /** Attributes repair and retry calls to the caller's AI budget. */
  userId?: string;
  signal?: AbortSignal;
}

/**
 * Ask the model for JSON and get back a validated object.
 *
 * Wraps the call/parse/repair sequence that A1–A4 each used to spell out, and
 * adds the one case they all got wrong: a truncated response is retried with a
 * larger output budget rather than sent to the repair prompt.
 */
export async function completeJson<T>(
  opts: CompleteJsonOptions<T>,
): Promise<ParseResult<T> | ParseError> {
  let maxTokens = opts.maxTokens;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await chatCompletion({
        messages: opts.messages,
        temperature: opts.temperature ?? 0.2,
        maxTokens,
        jsonMode: true,
        signal: opts.signal,
        purpose: opts.purpose,
      });

      return await parseAndValidate(response.content, opts.schema, {
        userId: opts.userId,
        signal: opts.signal,
      });
    } catch (err) {
      if (!(err instanceof TruncatedResponseError) || attempt === 1) throw err;

      // The configured model spends part of its budget on `reasoning_content`
      // before writing a single character of the answer, so a plan that is only
      // a little too large comes back empty rather than half-written.
      maxTokens = Math.min(
        MAX_RETRY_TOKENS,
        err.maxTokens * TRUNCATION_RETRY_MULTIPLIER,
      );
      log.warn("output truncated, retrying with a larger budget", {
        purpose: opts.purpose,
        previousMaxTokens: err.maxTokens,
        maxTokens,
      });
      if (opts.userId) await recordExtraAiCall(opts.userId);
    }
  }

  return { success: false, error: "Exhausted truncation retries", repairCount: 0 };
}
