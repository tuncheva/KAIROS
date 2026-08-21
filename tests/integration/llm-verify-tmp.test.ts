/**
 * Temporary verification of the modelClient changes. Deleted after running.
 */
// `server-only` throws under a plain node runner; the repo stubs it for Vitest
// (see vitest.config.ts) and we need the same here.

const NEMO = "nvidia/nemotron-3-super-120b-a12b";
const DEEPSEEK = "deepseek-ai/deepseek-v4-flash-0731";

// Chain: dead primary -> healthy fallback. Set before importing ~/env.
process.env.LLM_MODEL = DEEPSEEK;
process.env.LLM_FALLBACK_MODEL = NEMO;

async function main() {
  const { chatCompletion, streamCompletion, LlmTimeoutError } = await import(
    "~/server/llm/core/modelClient"
  );

  // --- 1. chat_template_kwargs actually goes out, and per model --------------
  const seen: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push(JSON.parse(String(init.body)));
    return realFetch(url, init);
  }) as typeof fetch;

  console.log("1. chat_template_kwargs per model");
  await chatCompletion({
    messages: [{ role: "user", content: "hi" }],
    model: NEMO,
    maxTokens: 16,
    purpose: "verify.nemo",
  });
  console.log("   nemotron  ->", JSON.stringify(seen.at(-1)?.chat_template_kwargs));

  // Build-only check for the dead model: capture the body, then abort fast.
  try {
    await chatCompletion({
      messages: [{ role: "user", content: "hi" }],
      model: DEEPSEEK,
      maxTokens: 16,
      timeoutMs: 3_000,
      purpose: "verify.deepseek-body",
    });
  } catch {
    /* expected: it never answers */
  }
  console.log("   deepseek  ->", JSON.stringify(seen.at(-1)?.chat_template_kwargs));

  const plain = seen.find((b) => b.model === NEMO);
  console.log(
    "   (llama control, should be absent) ->",
    JSON.stringify(
      (
        await (async () => {
          try {
            await chatCompletion({
              messages: [{ role: "user", content: "hi" }],
              model: "meta/llama-3.1-8b-instruct",
              maxTokens: 8,
              purpose: "verify.llama",
            });
          } catch {}
          return seen.at(-1);
        })()
      )?.chat_template_kwargs,
    ),
  );
  void plain;

  globalThis.fetch = realFetch;

  // --- 2. Streaming first-byte guard on the dead model ----------------------
  console.log("2. streaming first-byte guard against the dead endpoint");
  const t0 = Date.now();
  try {
    for await (const ev of streamCompletion({
      messages: [{ role: "user", content: "hi" }],
      model: DEEPSEEK,
      maxTokens: 16,
      purpose: "verify.firstbyte",
    })) {
      if (ev.type === "done") console.log("   unexpectedly completed");
    }
  } catch (err: any) {
    console.log(
      `   failed after ${Date.now() - t0}ms | name=${err?.name} phase=${err?.phase ?? "-"} instanceof=${err instanceof LlmTimeoutError}`,
    );
  }

  // --- 3. The chain advances past a dead primary to the fallback -------------
  console.log("3. chain advance: dead primary -> fallback (streaming)");
  const t1 = Date.now();
  let text = "";
  let served = "";
  for await (const ev of streamCompletion({
    messages: [{ role: "user", content: "Кажи здравей на български, кратко." }],
    maxTokens: 256,
    purpose: "verify.chain",
  })) {
    if (ev.type === "content") text += ev.text;
    if (ev.type === "done") served = ev.model;
  }
  console.log(`   served by "${served}" after ${Date.now() - t1}ms`);
  console.log(`   answer: ${text.trim().slice(0, 120)}`);

  // --- 4. Same for non-streaming -------------------------------------------
  console.log("4. chain advance: dead primary -> fallback (non-streaming)");
  const t2 = Date.now();
  const res = await chatCompletion({
    messages: [{ role: "user", content: "Reply with one word: ready" }],
    maxTokens: 32,
    purpose: "verify.chain.sync",
  });
  console.log(
    `   served by "${res.model}" after ${Date.now() - t2}ms | content=${JSON.stringify(res.content.trim().slice(0, 60))}`,
  );

  // --- 5. A genuinely slow streamed answer is not killed by the guard -------
  console.log("5. slow but healthy stream is not killed");
  const t3 = Date.now();
  let chars = 0;
  for await (const ev of streamCompletion({
    messages: [{ role: "user", content: "Explain MoE routing in detail, at least 600 words." }],
    model: NEMO,
    maxTokens: 4096,
    purpose: "verify.slow",
  })) {
    if (ev.type === "content") chars += ev.text.length;
  }
  console.log(`   completed: ${chars} chars in ${Date.now() - t3}ms`);
}

const _unused = () => {
  /* handled by vitest */
};
void _unused;

import { it } from "vitest";
it("verifies modelClient changes against the live provider", async () => {
  await main();
}, 600_000);
