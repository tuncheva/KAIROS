/**
 * JSON parse + repair loop for agent outputs.
 *
 * The model sometimes returns markdown-fenced JSON or trailing text.
 * This module extracts, parses, and validates JSON against a Zod schema,
 * retrying with a repair prompt up to MAX_REPAIRS times.
 */
import type { z } from "zod";
import { simpleCompletion } from "./modelClient";

const MAX_REPAIRS = 2;

/**
 * Attempt to extract a JSON object from a string that may contain
 * markdown fences or surrounding text.
 */
function extractJson(raw: string): string {
  // Try to extract from ```json ... ``` fences
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
  const fenceMatch = fenceRegex.exec(raw);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  // Try to find a JSON object or array
  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");
  let start = -1;

  if (firstBrace === -1 && firstBracket === -1) return raw.trim();
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);

  const isObject = raw[start] === "{";
  const closeChar = isObject ? "}" : "]";

  // Find the matching close
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === (isObject ? "{" : "[")) depth++;
    if (raw[i] === closeChar) depth--;
    if (depth === 0) {
      return raw.slice(start, i + 1);
    }
  }

  return raw.slice(start);
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
 * Parse and validate a raw LLM response string against a Zod schema.
 * If validation fails, attempts up to MAX_REPAIRS repair prompts.
 */
export async function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts?: { model?: string },
): Promise<ParseResult<T> | ParseError> {
  let repairCount = 0;
  let current = raw;

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    try {
      const jsonStr = extractJson(current);
      const parsed = JSON.parse(jsonStr) as unknown;
      const validated = schema.parse(parsed);
      return { success: true, data: validated, repairCount };
    } catch (err) {
      if (attempt === MAX_REPAIRS) {
        return {
          success: false,
          error:
            err instanceof Error ? err.message : "Unknown parse/validation error",
          repairCount,
        };
      }

      // Attempt repair
      repairCount++;
      try {
        const errorMsg = err instanceof Error ? err.message : String(err);
        current = await simpleCompletion(
          "You are a JSON repair assistant. The user will give you an invalid JSON string and the error. Return ONLY the corrected valid JSON — no explanations, no fences, no extra text.",
          `Original:\n${current}\n\nError:\n${errorMsg}`,
          { model: opts?.model, temperature: 0, jsonMode: true },
        );
      } catch {
        // If repair call itself fails, bail
        return {
          success: false,
          error: "Repair prompt failed",
          repairCount,
        };
      }
    }
  }

  return { success: false, error: "Exhausted repair attempts", repairCount };
}
