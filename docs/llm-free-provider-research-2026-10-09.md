# Free LLM provider research — Bulgarian, tool calling, zero budget (2026-10-09)

Builds on [`llm-provider-research-2026-08-21.md`](./llm-provider-research-2026-08-21.md) and does not repeat it. That doc covers the agent loop's requirements, the measured token profile, and the NVIDIA trial terms in detail. [`model-research.md`](./model-research.md) and [`agent-env-vars.md`](./agent-env-vars.md) are still stale: they recommend Hugging Face + `Qwen/Qwen2.5-7B-Instruct`, and HF now gives free accounts no credits at all (see §8).

Every claim below links to the page it came from, checked 2026-10-09. **Unverified** means the owning provider does not publish the figure, so it comes from a secondary source or could not be confirmed.

## TL;DR

| Lane | Pick | Why |
| --- | --- | --- |
| **Dev, primary** | **NVIDIA NIM** (already wired), `moonshotai/kimi-k3` or `openai/gpt-oss-20b` | Free, ~40 RPM with no published daily cap, already verified in Bulgarian in this repo, and the only free host with enough headroom for a ~38k-token agent turn. Still dev-only: the terms ban personal data and allow NIM to train on what you send (unchanged, §1). |
| **Dev, fix now** | Replace `LLM_FALLBACK_MODEL=minimaxai/minimax-m3` | It is **no longer in NIM's `/v1/models`** (80 ids on 2026-10-09). The `nvidia` preset's `deepseek-v4-flash` / `deepseek-v4-pro` are gone from the list too. Use `moonshotai/kimi-k3` ↔ `openai/gpt-oss-20b` as the primary/fallback pair, or try `google/gemma-4-31b-it` / `z-ai/glm-5.3` after a Bulgarian probe. |
| **Dev, second key** | **Google Gemini API free tier**, `gemini-3.8-flash` (fast tier: `gemini-3.1-flash-lite`) | Bulgarian is on Google's official language list. OpenAI-compatible endpoint with tools. Best data terms of any free tier for a developer in Bulgaria: for EEA users, Google applies its *paid* data terms to free quota as well, so prompts are not used for training. Catch: Google does not publish the free numeric limits. Keep it as an `.env` swap, not a runtime fallback. |
| **Launch (paid)** | **Gemini API paid tier**, or **DeepInfra** (the 2026-08-21 lane) | Gemini paid is the only option here that serves EEA users under first-party terms, with no training and Bulgarian officially supported. `gemini-3.1-flash-lite` costs $0.25 / $1.50 per M tokens. `gemini-3.8-flash` costs $0.75 / $3.75 until 2026-12-31 and **doubles on 2027-01-01**. DeepInfra keeps the open-weight models used in dev (`gemma-4-31B-it` $0.20 / $0.40, `Kimi-K3` $2.85 / $14.25) with zero retention. |

Everything else on the list is either not free in a way the agent loop can use, or has been retired. Groq's 8K TPM is less than one typical turn per minute. SambaNova allows 20 requests/day. Cerebras is a 30-day trial. OpenRouter `:free` allows 50 requests/day and carries no model proven in Bulgarian. GitHub Models was **retired 2026-07-30**. Hugging Face now gives free users **no** monthly credits. Cloudflare's free 10k neurons/day is roughly 0.1M Qwen3.8 output tokens.

## What changed since 2026-08-21

- **NIM catalog moved.** `deepseek-ai/deepseek-v4-flash` and `deepseek-ai/deepseek-v4-pro` are no longer listed. `deepseek-ai/deepseek-v4.1-flash` is. `minimaxai/minimax-m3` and `openai/gpt-oss-120b` are gone. `moonshotai/kimi-k3`, `openai/gpt-oss-20b`, `z-ai/glm-5.3`, `z-ai/glm-5.3-flash` and `google/gemma-4-31b-it` are present, and there is still no Qwen ([`GET /v1/models`](https://integrate.api.nvidia.com/v1/models)). The build.nvidia.com page for MiniMax M3 still loads and shows no deprecation notice ([page](https://build.nvidia.com/minimaxai/minimax-m3)). So "not in `/models`" is the only signal. **Unverified** whether calls to it still succeed: run `pnpm llm:probe`. The hard-coded `nvidia` preset in [`src/server/llm/core/providers.ts`](../src/server/llm/core/providers.ts) still points at the delisted V4 ids.
- **NVIDIA trial terms re-published 2026-10-08** (`Last-Modified` header on the [PDF](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)). The clauses that matter read the same: §1.2 trial only and no production use, §3.3(iv) content used to improve NVIDIA's models, §4.3 no personal data.
- **GitHub Models is gone.** It "has been fully retired" as of 2026-07-30 ([GitHub Docs](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)).
- **Hugging Face free accounts get no credits.** Free users have "None" monthly credits. PRO gets $2.00 ([HF pricing](https://huggingface.co/docs/inference-providers/en/pricing)).
- **Groq added `qwen/qwen3.8-27b`** at the same 30 RPM / 1K RPD / 8K TPM / 200K TPD as gpt-oss ([Groq rate limits](https://console.groq.com/docs/rate-limits)).
- **Cerebras now serves `gpt-oss-120b` and `qwen-3.8-27b`** on the trial ([Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits)).
- **OpenRouter's free list churned.** It now has 14 models (Nemotron 3 family, Poolside Laguna, Inkling, Dots3, LFM 2.5…). There is still no free Qwen, DeepSeek, Gemma, GLM or Kimi ([Free Models collection](https://openrouter.ai/collections/free-models)).
- **Gemini lineup moved to 3.6–3.8 Flash.** All Flash and Flash-Lite models are free on the free tier. The 3.6, 3.7 and 3.8 Flash prices **double on 2027-01-01** ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), updated 2026-10-09).
- **Mistral renamed "La Plateforme / Experiment" to "Studio / Free mode"** and publishes no numbers for it ([Mistral help, 2026-08-12](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them)).

## How Bulgarian quality can (and cannot) be checked

Vendors' multilingual averages mostly **do not cover Bulgarian**:

- **Global-MMLU** has 42 language configs and Bulgarian is not one of them. **MMLU-ProX**, the benchmark Qwen reports, has 29 and no Bulgarian ([Global-MMLU card](https://huggingface.co/datasets/CohereLabs/Global-MMLU), [MMLU-ProX card](https://huggingface.co/datasets/li-lab/MMLU-ProX)).
- **INCLUDE** does have a `Bulgarian` config ([include-base-44](https://huggingface.co/datasets/CohereLabs/include-base-44)). No provider page checked here reports a per-language INCLUDE score for the candidates.
- Official language claims: Gemini lists **Bulgarian (bg)** explicitly ([Google Cloud model docs](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models)). Gemma 4 claims "over 140 languages" with no list ([model card](https://huggingface.co/google/gemma-4-31b-it)). Qwen3.8 claims "201 languages and dialects" with no list ([model card](https://huggingface.co/Qwen/Qwen3.8-27B)). None of these is a quality measure.

So **the in-repo probe stays the deciding test**. That means a Bulgarian sentence plus a tool call via `pnpm llm:probe`, then the A1 routing eval (case `tasks.bulgarian`). Results recorded so far, from the 2026-08-27/28 probe kept in project memory: `kimi-k3`, `minimax-m3` and `gpt-oss-120b` produced clean Bulgarian. `nemotron-3-super-120b-a12b` code-switched into Russian, German and Polish. The [2026-09-25 A1 eval](./diploma/evals/a1-routing-2026-09-25-openai-gpt-oss-20b.md) on `gpt-oss-20b` scored 72.7% routing overall and misrouted `tasks.bulgarian` (clarify instead of handoff). **Not yet probed:** Gemini 3.x Flash, Gemma 4 31B, GLM-5.3, DeepSeek V4.1 Flash, Qwen3.8-27B. For the thesis, an INCLUDE-Bulgarian run on the top two would be a citable number. **Unverified** whether any public leaderboard already has one.

## Comparison

"Turns/day" uses the 2026-08-21 profile: a typical turn is ~38k input + ~4k output tokens over ~4 requests.

| Provider | Free model fit (Bulgarian + tools) | OpenAI-compat | Free limits | Typical turns/day | Trains on free input? | EEA |
| --- | --- | --- | --- | --- | --- | --- |
| **NVIDIA NIM** | kimi-k3 ✔ (probed), gpt-oss-20b ✔, gemma-4-31b-it, glm-5.3, deepseek-v4.1-flash (not probed) | Yes | ~40 RPM, no published cap (**unverified**, staff forum figure) | Hundreds | **Yes**, ToS §3.3(iv); no personal data, §4.3 | Usable; US jurisdiction |
| **Gemini API** | 3.8/3.7/3.6/3.5 Flash, 3.5/3.1/2.5 Flash-Lite, Gemma 4; Bulgarian listed | Yes (beta) | Not published; per project in AI Studio | **Unverified** | **No for EEA users** (paid data terms apply to free quota) | Bulgaria listed; **free tier banned for apps serving EEA users** |
| Groq | gpt-oss-120b/20b, qwen3.8-27b | Yes | 30 RPM, 1K RPD, **8K TPM**, 200K TPD | ~5 | No retention by default; ZDR toggle | **Unverified** |
| Cerebras | gpt-oss-120b, qwen-3.8-27b | Yes | 5 RPM, 30K uncached TPM, 1M TPD; $5 credit, 30 days, card required | ~24 (for 30 days) | **Unverified** | **Unverified** |
| SambaNova | gpt-oss-120b, gemma-4-31B-it (preview), DeepSeek V3.1/3.2 | Yes | 20 RPM, **20 RPD**, 200K TPD | ~5 | **Unverified** | **Unverified** |
| OpenRouter `:free` | No Bulgarian-proven model; Nemotron family failed the Bulgarian probe | Yes | 20 RPM; 50 RPD (1,000 after a one-off $10 top-up) | ~12 | Per provider; separate free-model setting | EU routing is Business/Enterprise only |
| Mistral Studio Free | Mistral Large 3 / Medium 3.5 / Small 3.2 have tools; Bulgarian **unverified** | Close; `tool_choice` uses `any`, not `required` | Not published | **Unverified** | Opt-out toggle available | EU company |
| Cloudflare Workers AI | qwen3.8-27b, gemma-4-26b-a4b, gpt-oss-20b/120b, mistral-small-3.1 | Yes | 10,000 neurons/day; 300 RPM | ~0–1 | **Unverified** | Global |
| Hugging Face | Many | Yes | **No free credits** | 0 | Per provider | — |
| Together AI | No useful free model | Yes | Free tier not stated | 0 | — | — |
| GitHub Models | — | — | **Retired 2026-07-30** | 0 | — | — |
| Ollama (local) | gemma4:31b 19 GB, qwen3.8 18 GB | Yes | Hardware only | Minutes per turn on CPU | Never leaves machine | — |

## 1. NVIDIA NIM (build.nvidia.com) — keep as dev primary

- **Models now** ([`/v1/models`](https://integrate.api.nvidia.com/v1/models), 80 ids): `moonshotai/kimi-k3`, `moonshotai/kimi-k2.6`, `openai/gpt-oss-20b`, `z-ai/glm-5.3`, `z-ai/glm-5.3-flash`, `google/gemma-4-31b-it`, `deepseek-ai/deepseek-v4.1-flash`, `mistralai/mistral-large`. There is still **no Qwen**.
- **Limits:** NVIDIA still publishes no quota. Use the ~40 RPM baseline from the 2026-08-21 doc, which is **unverified** and based on forum staff statements. That is about 10 agent turns per minute, the most usable headroom of any free option.
- **Terms** ([Trial ToS PDF](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf), re-published 2026-10-08): §1.2 "limited trial purposes only and without use … in production". §3.3(iv) collects "User Content and Generated Content to improve NVIDIA products and services, including AI models". §4.3 bans uploading "any personal information relating to an identifiable individual". **Seed data only.**
- **Action:** `.env` currently has `LLM_FALLBACK_MODEL=minimaxai/minimax-m3`, which is delisted. Update it, then run `pnpm llm:probe`. Separately, the `nvidia` preset defaults in `providers.ts` (`deepseek-v4-flash` / `-pro`) are stale; that is out of scope for this doc.
- **Paid path:** none on the trial. Production needs a separate subscription (§1.4). That is NVIDIA AI Enterprise, not a per-token key, so it is not a practical launch lane.

## 2. Google Gemini API — best free data terms; the launch candidate

- **Free models:** Gemini 3.8, 3.7, 3.6 and 3.5 Flash, 3 Flash Preview, 2.5 Flash, 3.5, 3.1 and 2.5 Flash-Lite, Gemma 4 and 2.5 Pro are all "Free of charge" on the free tier. 3.1 Pro Preview is not ([pricing](https://ai.google.dev/gemini-api/docs/pricing), updated 2026-10-09).
- **Bulgarian:** listed as a supported language for all Gemini models ([Google Cloud docs](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models)). Not yet probed in this repo.
- **OpenAI compatibility:** base URL `https://generativelanguage.googleapis.com/v1beta/openai/`. Supports `tools`, `tool_choice: "auto"` and streaming with `stream_options.include_usage`. Structured output is via `response_format`, but plain `json_object` is not documented, so it is **unverified** for `jsonRepair.ts`. Google labels the layer "still in beta". "Reasoning can't be turned off for … Gemini 3 models", which costs output tokens on the fast tier ([OpenAI compat](https://ai.google.dev/gemini-api/docs/openai)).
- **Limits:** the rate-limit page publishes tier structure but no free-tier numbers. You have to check them in AI Studio ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), updated 2026-09-02). Secondary sources disagree widely, from 5 RPM / ~100 RPD up to 15 RPM / 1,500 RPD. **Unverified**: read the real numbers in AI Studio before relying on it.
- **Data terms** ([Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms), updated 2026-04-28):
  - Unpaid Services are normally used "to provide, improve, and develop Google products", with human review.
  - **But:** "If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms under 'How Google uses Your Data' in 'Paid Services' apply to all Services, including … unpaid quota". In other words, a Bulgarian developer's free-tier prompts are not used for training.
  - **Launch blocker:** "You may use only Paid Services when making API Clients available to users in the European Economic Area". Free is fine for dev and not allowed once real EEA users exist.
- **Availability:** Bulgaria is on the supported-countries list ([available regions](https://ai.google.dev/gemini-api/docs/available-regions)).
- **Paid path:** the same key and code once billing is enabled. `gemini-3.1-flash-lite` costs $0.25 in / $1.50 out. `gemini-3.5-flash-lite` costs $0.30 / $2.50. `gemini-3.8-flash` costs $0.75 / $3.75 through 2026-12-31, then $1.50 / $7.50. Paid content is "not used to improve our products" ([pricing](https://ai.google.dev/gemini-api/docs/pricing)).

## 3. Groq

- `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` each get 30 RPM / 1K RPD / **8K TPM** / 200K TPD ([rate limits](https://console.groq.com/docs/rate-limits)). The page renders one table under both "Free Plan" and "Developer Plan" tabs and calls it the Developer base limit, so the exact free figures are **unverified**. They match the free numbers in the 2026-08-21 doc. Even at 8K TPM, one 38k turn takes ~5 minutes and 200K TPD allows ~5 turns. **Not viable** for the loop.
- Data: "By default, Groq does not retain customer data for inference requests", and ZDR can be enabled ([Your data](https://console.groq.com/docs/your-data)). The page does not say whether Groq trains on data: **unverified**.
- Paid: `qwen/qwen3.8-27b` costs $0.80 in / $4.00 out with 131K context ([model page](https://console.groq.com/docs/model/qwen/qwen3.8-27b)).

## 4. Cerebras

- Trial: `gpt-oss-120b` and `qwen-3.8-27b` at 5 RPM, 30K uncached TPM and 1M TPD ([rate limits](https://inference-docs.cerebras.ai/support/rate-limits)). It is a "one-time $5 promotional credit" that requires a payment method and "expires 30 days after activation" ([pricing](https://www.cerebras.ai/pricing)). Good for a one-off eval run of Qwen3.8 in Bulgarian, not as a baseline. Data and EEA terms: **unverified**.

## 5. OpenRouter `:free`

- Limits: 20 RPM; 50 RPD with fewer than 10 credits purchased, 1,000 RPD with 10 or more ([limits](https://openrouter.ai/docs/api-reference/limits)).
- Current free list (14 models): Nemotron 3 Ultra, Nemotron 3 Super, Nemotron 3.5 Lightning, Nemotron 3 Nano Omni, Poolside Laguna S/XS 2.1, Inkling and Inkling Small, Dots3-Note Preview, Ling 3.1 Flash, Apodex 1.1 Mini, Cohere North Mini Code, Mercury Decide, LFM 2.5 ([collection](https://openrouter.ai/collections/free-models)). The Nemotron family is the one that failed the Bulgarian probe. None of the others has been probed. A `qwen/qwen3.8-27b-20260814:free` slug turns up in search results but is not in the collection: **unverified / likely ended**.
- Data: "There are separate settings for paid and free models", and some providers may train on data. EU in-region routing (`eu.openrouter.ai`) is Business/Enterprise only ([provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging)).

## 6. Mistral Studio (formerly La Plateforme), Free mode

- "Free mode (the default) has the lowest limits, intended for evaluation and prototyping". No numbers are published; they show on the console Limits page. Buying credits does not raise limits; tiers rise with cumulative billing (Tier 2 above €20) ([help, 2026-08-12](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them)). The often-quoted "1 RPS / 500K TPM / 1B tokens per month" figure is **unverified**: the help article it came from now returns 404.
- Training: customers "have the right to opt out at any time" via Admin → Privacy → *Anonymous improvement data* ([help](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training)).
- Tools: Mistral Large 3, Medium 3.5, Small 3.2 and Ministral 3 support function calling. `tool_choice` takes `auto | any | none`, so OpenAI's `required` maps to `any`. Mistral's docs do not claim OpenAI compatibility ([function calling](https://docs.mistral.ai/capabilities/function_calling)). KAIROS sends `tool_choice: "auto"` by default (`modelClient.ts:576`), so this is compatible in principle. **Unverified** in practice.
- Bulgarian: no official per-language claim found. **Unverified.** It is an EU (French) company, which helps for the launch data story, but limits that are unpublished and only visible in the console make it hard to plan around.

## 7. SambaNova

- Free tier ("no payment method linked"): DeepSeek-V3.1, gpt-oss-120b, Llama-3.3-70B, DeepSeek-V3.2 (preview), gemma-4-31B-it (preview), each at 20 RPM, **20 RPD** and 200K TPD ([rate limits](https://docs.sambanova.ai/docs/en/models/rate-limits.md)). About 5 agent turns per day. **Not viable.**

## 8. Hugging Face Inference Providers

- Free users get "None" monthly credits and must buy credits; PRO gets $2.00 per month ([pricing](https://huggingface.co/docs/inference-providers/en/pricing)). The setup in `agent-env-vars.md` is therefore no longer free.

## 9. Cloudflare Workers AI

- 10,000 Neurons per day free. `@cf/qwen/qwen3.8-27b` costs 40,909 neurons per M input and 290,909 per M output ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). That is about 0.24M input tokens a day, or roughly 6 typical turns' input with no output budget. Text generation is limited to 300 RPM ([limits](https://developers.cloudflare.com/workers-ai/platform/limits/)). It has an OpenAI-compatible endpoint at `…/accounts/{id}/ai/v1` ([OpenAI compat](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)). The function-calling docs centre on Cloudflare's own "embedded" helper ([function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/)); OpenAI-style `tools` on this endpoint is **unverified**.

## 10. Together AI

- No free tier is stated. Its only $0 model (Ternary Bonsai 27B) does not fit. Paid: gpt-oss-120B $0.15 / $0.60, Gemma 4 31B $0.39 / $0.97, Kimi K3 $2.70 / $13.50 on promotion until 2026-10-11 ([pricing](https://www.together.ai/pricing)).

## 11. GitHub Models — retired

- "Fully retired" 2026-07-30 ([GitHub Docs](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)).

## 12. Local Ollama

- Free apart from hardware. `gemma4:31b` is 19 GB, `gemma4:26b` 16 GB, `gemma4:12b` 7.7 GB ([library](https://ollama.com/library/gemma4)), and `qwen3.8` 18 GB ([library](https://ollama.com/library/qwen3.8)). The 2026-08-21 hardware finding still holds: on an i7-11850H with integrated graphics, an 8-iteration loop takes minutes. It is still worth running once as a **private, offline Bulgarian eval** of Gemma 4 12B, because no data leaves the machine.

## Launch upgrade path

1. **Gemini paid tier.** Enable billing on the same project. Code stays the same apart from `LLM_BASE_URL`/`LLM_MODEL`. It is EEA-permitted, prompts are not used for training, and Bulgarian is officially supported. Budget carefully: the 3.6–3.8 Flash prices double on 2027-01-01, and the 2027 defence falls after that date. `gemini-3.1-flash-lite` ($0.25 / $1.50) is the price-stable fast tier ([pricing](https://ai.google.dev/gemini-api/docs/pricing)). A GDPR DPA / EU data residency for the Gemini API is **unverified** in this pass.
2. **DeepInfra.** This keeps the dev model family. It runs zero retention (2026-08-21 doc) and currently lists `gemma-4-31B-it` at $0.20 / $0.40, `Kimi-K3` at $2.85 / $14.25 and `Kimi-K2.6` at $0.75 / $3.50 ([pricing](https://deepinfra.com/pricing)). Its US jurisdiction needs SCCs for EU users.
3. **Mistral paid** is an option if EU-company residency becomes a requirement. Probe its Bulgarian quality first.

## Next steps (not done here)

1. Replace the delisted `minimaxai/minimax-m3` fallback in `.env`, then run `pnpm llm:probe`.
2. Create a free AI Studio key and read the real free limits for `gemini-3.8-flash` and `gemini-3.1-flash-lite`. Probe Bulgarian plus a tool call, and test `response_format: json_object`.
3. Run the A1 routing eval on Gemini 3.8 Flash and on `kimi-k3` to compare against the `gpt-oss-20b` 72.7% baseline, particularly `tasks.bulgarian`.

## Sources

Checked 2026-10-09.

- [NVIDIA NIM `/v1/models`](https://integrate.api.nvidia.com/v1/models)
- [NVIDIA API Trial Terms of Service (PDF)](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
- [build.nvidia.com — MiniMax M3](https://build.nvidia.com/minimaxai/minimax-m3)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)
- [Gemini API available regions](https://ai.google.dev/gemini-api/docs/available-regions)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Google Cloud — Gemini language support](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models)
- [Groq rate limits](https://console.groq.com/docs/rate-limits) · [Groq data](https://console.groq.com/docs/your-data) · [Groq qwen3.8-27b](https://console.groq.com/docs/model/qwen/qwen3.8-27b)
- [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits) · [Cerebras pricing](https://www.cerebras.ai/pricing)
- [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits) · [Free models collection](https://openrouter.ai/collections/free-models) · [Provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging)
- [Mistral rate limits help](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them) · [Mistral training opt-out](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training) · [Mistral function calling](https://docs.mistral.ai/capabilities/function_calling)
- [SambaNova rate limits](https://docs.sambanova.ai/docs/en/models/rate-limits.md)
- [Hugging Face Inference Providers pricing](https://huggingface.co/docs/inference-providers/en/pricing)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [limits](https://developers.cloudflare.com/workers-ai/platform/limits/) · [OpenAI compat](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) · [function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/)
- [Together AI pricing](https://www.together.ai/pricing)
- [GitHub Models retirement](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)
- [DeepInfra pricing](https://deepinfra.com/pricing)
- [Ollama gemma4](https://ollama.com/library/gemma4) · [Ollama qwen3.8](https://ollama.com/library/qwen3.8)
- Model cards: [Gemma 4 31B](https://huggingface.co/google/gemma-4-31b-it) · [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B)
- Benchmarks: [Global-MMLU](https://huggingface.co/datasets/CohereLabs/Global-MMLU) · [INCLUDE](https://huggingface.co/datasets/CohereLabs/include-base-44) · [MMLU-ProX](https://huggingface.co/datasets/li-lab/MMLU-ProX)
