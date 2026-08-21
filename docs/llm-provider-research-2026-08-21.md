# LLM provider research — replacing the work DeepSeek gateway (2026-08-21)

Supersedes [`docs/model-research.md`](./model-research.md) and [`docs/agent-env-vars.md`](./agent-env-vars.md) for provider selection. Both predate the current agent stack: they recommend `Qwen/Qwen2.5-7B-Instruct` via Hugging Face and reference `LLM_DEFAULT_MODEL` / `LLM_REASONING_MODEL`, which [`src/env.js`](../src/env.js) no longer defines.

## Problem

The agents currently run against a corporate gateway:

```
LLM_BASE_URL=https://chat.velocity.online/api/v1
LLM_MODEL=deepseek/deepseek-v4-flash
```

That key belongs to work and cannot be used at home. We need either a free equivalent or the cheapest close substitute.

> **Unresolved:** the model was described verbally as DeepSeek V4 **Pro**, but `.env` pins **Flash**. They are different models at roughly 3× different prices. This document assumes Flash. Confirm what the gateway actually routes to before committing to a cost baseline.

## What a replacement must satisfy

Derived from the code, not from a generic checklist. Anything failing one of these breaks the loop rather than degrading it.

| Requirement | Where it comes from |
| --- | --- |
| OpenAI-compatible `/chat/completions` | [`modelClient.ts`](../src/server/llm/core/modelClient.ts) hand-rolls the wire format; no provider SDK |
| `tools` + `tool_choice` | A1 concierge ships 19 tool definitions (~3.7k tokens of schema) |
| Up to 8 iterations, 4 concurrent calls | `DEFAULT_MAX_ITERATIONS` / `TOOL_CONCURRENCY` in [`toolLoop.ts`](../src/server/llm/core/toolLoop.ts) |
| `reasoning_content` (optional) | Client separates reasoning deltas from content; `DEFAULT_MAX_TOKENS = 8192` is sized for reasoning **plus** answer |
| `stream_options: { include_usage: true }` | Otherwise streamed calls report no usage and cost accounting goes blind |
| `response_format: json_object` | Used on tool-free structured turns |
| ≥128k context | Tool results capped at 12k chars each; a heavy turn accumulates a large prompt |
| Prompt caching (desirable) | System prompt + tool schemas are re-sent every iteration — this is where the cost actually lives |

### Measured token profile

Taken from actual prompt sizes in `src/server/llm`:

- Base per request (system profile + tool schemas): **~4,200 tokens**
- Light turn (2 iterations): ~10k cumulative input, ~2.3k output
- Typical turn (4 iterations): **~38k cumulative input, ~4.1k output**
- Heavy turn (8 iterations, maxed tool results): ~100k+ cumulative input, ~7.7k output

All cost figures below use the typical turn at 40 turns/day, assuming 75% of input hits a prompt cache where the provider offers one.

## Key finding

DeepSeek V4 is open-weight under MIT. The exact weights already in production are available elsewhere — including free. No model migration is required, and no re-tuning of the 19 tool schemas.

A corollary: **DeepSeek's own API is one of the most expensive places to buy DeepSeek.** Third-party hosts undercut first-party by 3–5×.

## Cost comparison

| Provider / model | In /M | Cached /M | Out /M | $/turn | $/month |
| --- | --- | --- | --- | --- | --- |
| NVIDIA NIM `deepseek-v4-flash` (free tier) | — | — | — | 0.0000 | **0.00** |
| DeepInfra `deepseek-ai/DeepSeek-V4-Flash-0731` | 0.08 | 0.016 | 0.18 | 0.0020 | **2.35** |
| OpenRouter → DigitalOcean (cheapest of 18 hosts) | 0.068 | n/a | 0.168 | 0.0033 | 3.93 |
| SiliconFlow V4 Flash | 0.14 | 0.028 | 0.28 | 0.0033 | 3.93 |
| DeepSeek official, V4 Flash off-peak | 0.22 | 0.007 | 0.66 | 0.0050 | 6.00 |
| DeepSeek official, V4 Flash peak | 0.44 | 0.014 | 1.32 | 0.0100 | 12.00 |
| DeepSeek official, V4 Pro off-peak | 0.66 | 0.022 | 1.98 | 0.0150 | 18.03 |
| DeepInfra `DeepSeek-V4-Pro` | 1.30 | 0.10 | 2.60 | 0.0259 | 31.06 |

DeepSeek's peak window is 01:00–04:00 and 06:00–10:00 UTC — a European working morning — at double the off-peak rate.

## Data handling

KAIROS is an EU application: Supabase on `eu-west-1`, locales `bg / de / en / es / fr`. Where the prompt lands is a GDPR question.

The agent tools send identifiable personal data on every turn. [`readTools.ts`](../src/server/llm/tools/a1/readTools.ts) `getSessionContext` returns the user's `email` and `name`; `getProjectDetail` returns collaborator names.

| Host | Retention | Trains on content | Jurisdiction | Real user data |
| --- | --- | --- | --- | --- |
| NVIDIA NIM (trial) | Session + abuse logs | Yes — ToS §3.3(iv) | US | **No** |
| DeepInfra | Zero retention | No | US — SOC 2, ISO 27001 | **Yes** |
| DeepSeek official | Stored | Per its policy | People's Republic of China | **No** |

DeepSeek's privacy policy states personal data is stored in the PRC. The Italian Garante found that disclosure incompatible with GDPR safeguards, and the Berlin commissioner alleged an Art. 46(1) violation over the transfers. Rule the first-party API out for this app — it is also the most expensive option.

## Recommendation: two lanes

### Development — NVIDIA NIM, free

Serves both `deepseek-v4-flash` and `deepseek-v4-pro`, OpenAI-compatible, with tool calling, JSON mode and reasoning content. Requires a free NVIDIA Developer account with phone verification.

```
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_API_KEY=nvapi-...
LLM_MODEL=deepseek-ai/deepseek-v4-flash
LLM_FALLBACK_MODEL=deepseek-ai/deepseek-v4-pro
LLM_MODEL_FAST=deepseek-ai/deepseek-v4-flash
```

**Use only with your own account and seed data.** See the limits section below.

### Real user data — DeepInfra, ~$2.35/month

Same weights, zero retention, no training on customer data, SOC 2 and ISO 27001, GDPR terms available. Cheaper per token than DeepSeek's own API.

Because provider selection is entirely env-driven, switching lanes per environment is a config change with no code impact.

## Limits of the NVIDIA free tier

Verified against the [NVIDIA API Trial Terms of Service](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) itself. Several secondary write-ups describe this tier as unlimited and non-training; the governing document contradicts both claims.

- **Personal data is prohibited.** §4.3: "you will not upload any personal information relating to an identifiable individual", nor anything subject to data privacy law. NVIDIA "specifically disclaims" that its servers are appropriate for processing personal data. §2.6(a) repeats the ban. Our tools send `email` and `name` every turn.
- **Content may train NVIDIA's models.** §3.3(iv): NVIDIA collects "User Content and Generated Content to improve NVIDIA products and services, including AI models." §2.3's session-only retention is explicitly subject to §3.3.
- **Production is excluded.** §1.2 grants access "for limited trial purposes only and without use of the API Service or Generated Content in production." §1.4 requires a paid subscription for production use or once credits are consumed. §1.3 classes the service as pre-release, terminable "at any time without liability."
- **Credits still exist on paper.** Staff describe trial usage as not credit-based, governed by a traffic-dependent rate limit, and the meter is absent from the UI for most models — but §1.4 keeps Credits in the contract, and credit-increase requests were still being filed through mid-2026. Treat the absence of a meter as a courtesy, not a guarantee.
- **~40 RPM, no guaranteed quota, no appeal.** NVIDIA publishes no quota; staff cite ~40 requests/minute as a baseline dependent on model and overall traffic, with 429s under load. A forum moderator states there is no official route to a rate limit increase on that tier. For our loop 40 RPM is ~10 agent turns/minute — ample. **Rate is not the constraint; the terms are.**
- **Context truncated below the advertised 1M.** Hosted endpoints advertise 1M in `/v1/models` but enforce less: V4 Pro, GLM-5.2 and MiniMax M3 are reported truncated to ~200–250k. V4 Flash tested clean to 1M. Our heavy turn tops out near 100k, so this is a footnote.

### Required code change for NIM

NIM needs a non-standard parameter at the body root to enable DeepSeek V4 reasoning; requests have been reported to hang without it. Single patch point — `buildBody()` in [`modelClient.ts`](../src/server/llm/core/modelClient.ts):

```ts
// NIM requires chat_template_kwargs at the body root for DeepSeek V4 reasoning.
if (getBaseUrl().includes("integrate.api.nvidia.com")) {
  body.chat_template_kwargs = { thinking: true };
  body.reasoning_effort = "high"; // "none" | "high" | "max"
}
```

Verify any provider swap with `pnpm llm:probe`.

## Considered and rejected

- **Running locally.** The target machine is an i7-11850H with 32 GB RAM and Intel UHD integrated graphics. V4 Flash is 284B parameters (13B activated). Even a 14B model would run on CPU at single-digit tokens/sec; an 8-iteration loop would take minutes per turn. Local inference is a hardware purchase, not a config change.
- **Groq free tier.** 8k tokens/minute and 200k tokens/day for `gpt-oss-120b` per Groq's own docs. Our base prompt alone is 4.2k and a typical turn is ~38k — under five agent turns per day, and a single iteration can breach the per-minute cap.
- **Cerebras free tier.** Advertised as free but documented as $5 of credits expiring after 30 days, 5 RPM, 1M tokens/day (~24 agent turns). Fine for evaluation, not a baseline.
- **OpenRouter `:free` models.** The live list currently carries only Nemotron 3.5 Lightning, Dots3-Note Preview, Poolside Laguna and LFM 2.5 — no free DeepSeek, Qwen, GLM or Kimi. Free tier is capped at 50 requests/day without credits. Still worth an account as the cheapest paid router.
- **Promotional free endpoints.** ZenMux lists `deepseek-v4-flash-free` (already flagged *Sunset*); OpenCode Zen exposes a free V4 Flash capped at 200k context. Limited-time promos — usable for spot checks, not for wiring the agents to.
- **DeepSeek's 5M signup grant.** New API accounts have been receiving 5M free tokens (~$8.40) valid 30 days, no card. Not guaranteed, not renewable, and the jurisdiction problem above applies regardless. Useful as a migration runway only.
- **Switching model family** (GLM-5.2, Kimi K3, MiniMax M3). All credible agentic models; MiniMax M3 is cheap at $0.30/$1.20. But each means re-tuning 19 tool schemas and a system prompt that already works, to solve a problem we do not have.

## Follow-up

- `reasoning_effort: "none"` is available on V4 Flash. The `LLM_MODEL_FAST` tier — conversation titles, rolling summaries, JSON repair, intent classification — has no reason to pay for reasoning tokens. Worth wiring into the fast chain regardless of provider.
- [`docs/agent-env-vars.md`](./agent-env-vars.md) documents variables that no longer exist. It should be rewritten against the current [`src/env.js`](../src/env.js) or deleted.

## Sources

Checked 2026-08-21.

- [NVIDIA API Trial Terms of Service (PDF)](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
- [build.nvidia.com — DeepSeek V4 Flash](https://build.nvidia.com/deepseek-ai/deepseek-v4-flash)
- [NVIDIA NIM API reference — V4 Flash](https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-flash)
- [NVIDIA NIM for Developers — free tier terms](https://developer.nvidia.com/nim)
- [NVIDIA forums — truncated context windows](https://forums.developer.nvidia.com/t/truncated-context-windows-of-several-models-intentional-or-mistakes/378940)
- [NIM enforces ~203k despite advertising 1M](https://github.com/Gitlawb/openclaude/issues/2126)
- [NIM hangs without `chat_template_kwargs`](https://github.com/anomalyco/opencode/issues/24264)
- [DeepSeek official pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [DeepSeek privacy policy — PRC storage](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [DeepInfra pricing](https://deepinfra.com/pricing)
- [DeepInfra — data privacy during inference](https://deepinfra.com/docs/data)
- [OpenRouter — 18 providers for V4 Flash](https://openrouter.ai/deepseek/deepseek-v4-flash)
- [OpenRouter live model list](https://openrouter.ai/api/v1/models)
- [Groq rate limits](https://console.groq.com/docs/rate-limits)
- [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Artificial Analysis — DeepSeek V4 Flash](https://artificialanalysis.ai/models/deepseek-v4-flash)
