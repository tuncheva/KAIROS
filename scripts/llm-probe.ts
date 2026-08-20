/**
 * LLM endpoint capability probe.
 *
 * The agent layer is being rebuilt around native tool calling, streaming and
 * schema-constrained JSON. Which of those a given OpenAI-compatible endpoint
 * actually implements varies wildly — "OpenAI-compatible" routinely means
 * `/chat/completions` and nothing else. Rather than assume, probe once and
 * build against the answer.
 *
 * Usage:
 *   pnpm llm:probe
 *
 * Reads LLM_BASE_URL / LLM_API_KEY / LLM_MODEL from the environment. Costs a
 * handful of tiny completions.
 */

const BASE_URL = (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, "");
const API_KEY = process.env.LLM_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "";

const PASS = "✓";
const FAIL = "✗";
const WARN = "!";

interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Set when the capability is optional and absence only degrades quality. */
  soft?: boolean;
}

const results: ProbeResult[] = [];

function record(name: string, ok: boolean, detail: string, soft = false) {
  results.push({ name, ok, detail, soft });
  const mark = ok ? PASS : soft ? WARN : FAIL;
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function post(
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, json, text };
}

interface ProbeMessage {
  content?: unknown;
  reasoning_content?: unknown;
  tool_calls?: unknown;
}

/** Pull `choices[0].message` out of a completion response without trusting its shape. */
function firstMessage(json: unknown): ProbeMessage | null {
  const choices = (json as { choices?: unknown[] } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: unknown }).message;
  return msg && typeof msg === "object" ? (msg as ProbeMessage) : null;
}

/** The message text, or "" for any shape that isn't a string. */
function messageText(json: unknown): string {
  const content = firstMessage(json)?.content;
  return typeof content === "string" ? content : "";
}

function errorDetail(status: number, json: unknown, text: string): string {
  const msg = (json as { error?: { message?: string } } | null)?.error?.message;
  return `HTTP ${String(status)}: ${(msg ?? text).slice(0, 160)}`;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

async function probeModels() {
  try {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      record("GET /models", false, `HTTP ${String(res.status)}`, true);
      return;
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    const listed = ids.includes(MODEL);
    record(
      "GET /models",
      true,
      `${String(ids.length)} models; "${MODEL}" ${listed ? "listed" : "NOT listed"}`,
      true,
    );
    if (!listed && ids.length > 0) {
      const near = ids.filter((id) => id.toLowerCase().includes("deepseek"));
      console.log(
        `      deepseek ids available: ${near.length ? near.join(", ") : "(none)"}`,
      );
    }
  } catch (err) {
    record(
      "GET /models",
      false,
      err instanceof Error ? err.message : String(err),
      true,
    );
  }
}

async function probeBasic() {
  const { status, json, text } = await post({
    model: MODEL,
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
    max_tokens: 16,
  });
  if (status !== 200) {
    record("chat/completions", false, errorDetail(status, json, text));
    return;
  }
  const msg = firstMessage(json);
  const usage = (json as { usage?: Record<string, unknown> }).usage;
  const served = (json as { model?: string }).model;
  record(
    "chat/completions",
    true,
    `served by "${served ?? "?"}", reply: ${JSON.stringify(messageText(json).slice(0, 40))}`,
  );
  record(
    "usage accounting",
    !!usage,
    usage ? `fields: ${Object.keys(usage).join(", ")}` : "no usage object returned",
    true,
  );
  // Some providers put reasoning in a separate field; worth knowing before we
  // parse JSON out of `content`.
  if (msg && "reasoning_content" in msg) {
    record("reasoning_content", true, "present — must be ignored when parsing JSON", true);
  }
}

async function probeJsonObject() {
  const { status, json, text } = await post({
    model: MODEL,
    messages: [
      { role: "system", content: "Reply only with JSON." },
      { role: "user", content: 'Return {"ok": true} and nothing else.' },
    ],
    response_format: { type: "json_object" },
    max_tokens: 64,
  });
  if (status !== 200) {
    record("response_format: json_object", false, errorDetail(status, json, text));
    return;
  }
  const content = messageText(json);
  let parses = false;
  try {
    JSON.parse(content);
    parses = true;
  } catch {
    /* accepted the param but did not honour it */
  }
  record(
    "response_format: json_object",
    true,
    parses ? "accepted, output parses as JSON" : "accepted but output was NOT valid JSON",
  );
}

async function probeJsonSchema() {
  const { status, json, text } = await post({
    model: MODEL,
    messages: [{ role: "user", content: "Give me a task titled Write docs." }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "task",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["title", "priority"],
          additionalProperties: false,
        },
      },
    },
    max_tokens: 128,
  });
  if (status !== 200) {
    record(
      "response_format: json_schema",
      false,
      errorDetail(status, json, text),
      true,
    );
    return;
  }
  const content = messageText(json);
  let conforms = false;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    conforms = typeof parsed.title === "string" && typeof parsed.priority === "string";
  } catch {
    /* ignore */
  }
  record(
    "response_format: json_schema",
    conforms,
    conforms ? "accepted and conformed" : `accepted but output did not conform: ${content.slice(0, 80)}`,
    true,
  );
}

async function probeTools() {
  const { status, json, text } = await post({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: "How many tasks are in project 7? Use the tool.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "listTasks",
          description: "List the tasks belonging to a project.",
          parameters: {
            type: "object",
            properties: {
              projectId: { type: "number", description: "Project id" },
            },
            required: ["projectId"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: "auto",
    max_tokens: 256,
  });

  if (status !== 200) {
    record("tools (function calling)", false, errorDetail(status, json, text));
    return;
  }

  const msg = firstMessage(json);
  const toolCalls = msg?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    record(
      "tools (function calling)",
      false,
      `accepted the param but returned no tool_calls (content: ${messageText(json).slice(0, 80)})`,
    );
    return;
  }

  const call = toolCalls[0] as { id?: string; function?: { name?: string; arguments?: string } };
  let argsOk = false;
  try {
    const parsed = JSON.parse(call.function?.arguments ?? "") as { projectId?: unknown };
    argsOk = typeof parsed.projectId === "number";
  } catch {
    /* ignore */
  }
  record(
    "tools (function calling)",
    true,
    `called "${call.function?.name ?? "?"}", args ${argsOk ? "parsed correctly" : `unexpected: ${call.function?.arguments ?? ""}`}, id ${call.id ? "present" : "MISSING"}`,
  );

  // A tool loop is only possible if the endpoint accepts the tool result back.
  await probeToolRoundTrip(call);
}

/** Feed a tool result back and confirm the endpoint completes the round trip. */
async function probeToolRoundTrip(call: {
  id?: string;
  function?: { name?: string; arguments?: string };
}) {
  const { status, json, text } = await post({
    model: MODEL,
    messages: [
      { role: "user", content: "How many tasks are in project 7? Use the tool." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: call.id ?? "call_1",
            type: "function",
            function: {
              name: call.function?.name ?? "listTasks",
              arguments: call.function?.arguments ?? '{"projectId":7}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: call.id ?? "call_1",
        content: JSON.stringify([{ id: 1, title: "Write docs" }, { id: 2, title: "Ship it" }]),
      },
    ],
    max_tokens: 128,
  });

  if (status !== 200) {
    record("tool result round-trip", false, errorDetail(status, json, text));
    return;
  }
  const content = messageText(json);
  record(
    "tool result round-trip",
    content.length > 0,
    content ? `answered: ${JSON.stringify(content.slice(0, 60))}` : "empty answer",
  );
}

async function probeStreaming() {
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Count from 1 to 10, space separated." }],
        stream: true,
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok || !res.body) {
      record("stream: true", false, `HTTP ${String(res.status)}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let frames = 0;
    let chars = 0;
    let sawDone = false;
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          sawDone = true;
          continue;
        }
        frames++;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          chars += (parsed.choices?.[0]?.delta?.content ?? "").length;
        } catch {
          /* keep counting frames */
        }
      }
    }

    record(
      "stream: true",
      frames > 1,
      `${String(frames)} SSE frames, ${String(chars)} chars, [DONE] ${sawDone ? "sent" : "absent"}`,
    );
  } catch (err) {
    record("stream: true", false, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!BASE_URL || !API_KEY || !MODEL) {
    console.error(
      "LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must all be set.\n" +
        "Run it through dotenv:  pnpm llm:probe",
    );
    process.exit(1);
  }

  console.log(`\nProbing ${BASE_URL}`);
  console.log(`Model:   ${MODEL}\n`);

  await probeModels();
  await probeBasic();
  await probeJsonObject();
  await probeJsonSchema();
  await probeTools();
  await probeStreaming();

  const hardFailures = results.filter((r) => !r.ok && !r.soft);
  const toolsOk = results.find((r) => r.name === "tools (function calling)")?.ok ?? false;
  const roundTripOk = results.find((r) => r.name === "tool result round-trip")?.ok ?? false;

  console.log("\n─── Verdict ───");
  if (toolsOk && roundTripOk) {
    console.log(`${PASS} Native tool calling works. Build the tool loop on it.`);
  } else {
    console.log(
      `${FAIL} Native tool calling unavailable. Use the JSON tool-call protocol\n` +
        "  fallback, or point LLM_BASE_URL at a provider that supports tools.",
    );
  }
  console.log(
    hardFailures.length === 0
      ? `${PASS} No blocking failures.`
      : `${FAIL} ${String(hardFailures.length)} blocking failure(s): ${hardFailures.map((f) => f.name).join(", ")}`,
  );
  console.log("");
}

main().catch((err: unknown) => {
  console.error("Probe crashed:", err);
  process.exit(1);
});
