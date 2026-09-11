/**
 * Where does an A1 turn's latency actually go on this gateway?
 *
 * The reasoning-effort dial is documented in `modelClient.ts` with numbers
 * measured on NVIDIA NIM serving gpt-oss — a different model on a different
 * gateway. Before treating it as the main latency lever here, measure it here:
 * vary the effort and the prompt size independently and see which one moves.
 *
 * Also checks that the JSON contract survives whatever the cheap setting is,
 * since the call this affects is the one that has to emit A1's whole object.
 *
 * Usage: dotenv -e .env -- tsx scripts/effort-probe.ts
 */

import { resolveLlmConfig } from "../src/server/llm/core/providers";

const CONFIG = resolveLlmConfig(process.env);
const MODEL = CONFIG.models[0] ?? "";

const TRIALS = 3;

const BASE_SYSTEM = `You are the KAIROS Workspace Concierge — a warm, concise assistant inside the KAIROS project management platform.

Answer directly without tools only for greetings, capability questions and follow-ups you can already answer from this conversation.

## Output
Reply with a single JSON object and nothing else — no markdown fence, no commentary:
{
  "intent": { "type": "answer" | "handoff" | "clarify", "scope": { "projectId?": number } },
  "answer?": { "summary": "string", "details?": ["string"] },
  "followUps?": ["string"]
}
Exactly one of "answer", "handoffs" or "clarify" is present, matching intent.type.`;

/**
 * Filler that stands in for the ~5,600 prompt tokens a real A1 turn carries:
 * the rules, the memory block, the workspace JSON and 26 tool schemas. Content
 * is irrelevant — only the token count is being varied.
 */
function padding(approxTokens: number): string {
  const line =
    "- Reference material: project status, task ownership, due dates, blockers, collaborators, and activity history.\n";
  return line.repeat(Math.ceil((approxTokens * 4) / line.length));
}

interface Wire {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function ask(system: string, message: string, effort: string) {
  const startedAt = Date.now();
  const res = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
      temperature: 0.2,
      max_tokens: 2048,
      reasoning_effort: effort,
    }),
  });

  const ms = Date.now() - startedAt;
  if (!res.ok) return { ms, ok: false, promptTokens: 0, reasoning: 0 };

  const body = (await res.json()) as Wire;
  const content = body.choices?.[0]?.message?.content ?? "";
  const reasoning = body.choices?.[0]?.message?.reasoning_content ?? "";

  let ok = false;
  try {
    const parsed = JSON.parse(content.trim()) as { intent?: unknown };
    ok = typeof parsed.intent === "object" && parsed.intent !== null;
  } catch {
    ok = false;
  }

  return {
    ms,
    ok,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    reasoning: reasoning.length,
  };
}

function stats(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return `median ${String(median)}ms  (${sorted.map(String).join(", ")})`;
}

async function main() {
  console.log(`model: ${MODEL}`);
  console.log(`endpoint: ${CONFIG.baseUrl}`);
  console.log(`trials per cell: ${String(TRIALS)}\n`);

  const cells: Array<{ label: string; system: string; effort: string }> = [
    { label: "small prompt, effort=low ", system: BASE_SYSTEM, effort: "low" },
    { label: "small prompt, effort=high", system: BASE_SYSTEM, effort: "high" },
    {
      label: "real-size prompt, effort=low ",
      system: `${BASE_SYSTEM}\n\n${padding(5000)}`,
      effort: "low",
    },
    {
      label: "real-size prompt, effort=high",
      system: `${BASE_SYSTEM}\n\n${padding(5000)}`,
      effort: "high",
    },
  ];

  for (const cell of cells) {
    const times: number[] = [];
    let contractOk = true;
    let promptTokens = 0;
    let reasoning = 0;

    for (let i = 0; i < TRIALS; i++) {
      const r = await ask(cell.system, "what can you do?", cell.effort);
      times.push(r.ms);
      if (!r.ok) contractOk = false;
      promptTokens = r.promptTokens;
      reasoning = Math.max(reasoning, r.reasoning);
    }

    console.log(
      `${cell.label}  ${stats(times)}  promptTokens ${String(promptTokens)}  maxReasoning ${String(reasoning)}ch  json ${contractOk ? "ok" : "BROKEN"}`,
    );
  }
}

void main();
