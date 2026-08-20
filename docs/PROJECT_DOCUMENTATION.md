# Kairos Agents & Free Models — Deep Research (2026)

> Scope: identify which agent types Kairos can contain (given current code structure) and recommend the best **free-to-run** models (open weights) with licensing notes, plus an explicit “best choice” recommendation.
>
> Sources are gathered via MCP web search/scrape and linked.

---

## 0) TL;DR — best pick(s)

### If you want the **best overall free model family** for Kairos agents
- **Qwen2.5 Instruct (7B or 14B)** — **Apache 2.0**, strong instruction following, strong JSON/structured outputs, long context support.
  - Source: Qwen2.5 model card (capabilities + long context): https://huggingface.co/Qwen/Qwen2.5-7B-Instruct
  - Source: Qwen license (Apache 2.0): https://huggingface.co/Qwen/Qwen2.5-14B-Instruct/blob/main/LICENSE

### If you want the **best lightweight** free model for a single-GPU / low-cost box
- **Phi-3.5-mini-instruct (3.8B)** — **MIT**, 128K context, good reasoning for size.
  - Source: model card: https://huggingface.co/microsoft/Phi-3.5-mini-instruct
  - Source: license (MIT): https://huggingface.co/microsoft/Phi-3.5-mini-instruct/blob/main/LICENSE

### If you want “**small but very capable**” and permissive license
- **Mistral NeMo Instruct (12B)** — **Apache 2.0**, 128K context.
  - Source: announcement: https://mistral.ai/news/mistral-nemo

### If you want “**fully open science**” (weights + training flow openness)
- **OLMo 2 Instruct (7B/13B)** — **Apache 2.0**.
  - Source: model card: https://huggingface.co/allenai/OLMo-2-1124-7B-Instruct
  - Source: project page: https://allenai.org/olmo

### If you want the **best open reasoning** model (but heavy)
- **DeepSeek-R1** and distilled checkpoints (MIT); beware deployment complexity.
  - Source: release note (MIT licensing): https://api-docs.deepseek.com/news/news250120
  - Source: HF model card: https://huggingface.co/deepseek-ai/DeepSeek-R1

---

## 1) What agents Kairos can contain (based on current codebase)

Kairos currently ships four agents, identified by the [`AgentId`](src/server/llm/orchestrator/shared.ts) union (`workspace_concierge`, `task_planner`, `notes_vault`, `events_publisher`).

The architecture supports many more agents because each follows the same draft → confirm → apply lifecycle, built from shared pieces:

- Agent IDs + shared types: [`shared.ts`](src/server/llm/orchestrator/shared.ts)
- Orchestration (routing + apply): [`agentOrchestrator.ts`](src/server/llm/orchestrator/agentOrchestrator.ts)
- Model client (structured JSON via Zod): [`modelClient.ts`](src/server/llm/core/modelClient.ts)
- Context builders: [`src/server/llm/context/`](src/server/llm/context)
- Profiles, prompts and schemas: [`src/server/llm/profiles/`](src/server/llm/profiles), [`src/server/llm/prompts/`](src/server/llm/prompts), [`src/server/llm/schemas/`](src/server/llm/schemas)

### Existing agents today
- **A1 Workspace Concierge** — [`a1Concierge.ts`](src/server/llm/orchestrator/a1Concierge.ts)
- **A2 Task Planner** — [`a2TaskPlanner.ts`](src/server/llm/orchestrator/a2TaskPlanner.ts)
- **A3 Notes Vault** — [`a3NotesVault.ts`](src/server/llm/orchestrator/a3NotesVault.ts)
- **A4 Events Publisher** — [`a4EventsPublisher.ts`](src/server/llm/orchestrator/a4EventsPublisher.ts)

All exposed via tRPC in [`agentRouter`](src/server/api/routers/agent.ts).

### Recommended agent catalog (roadmap)
These map cleanly to your existing data model/routers (projects/tasks/notes/chat/org/notifications):

#### A) Project & task agents
1. **Project planning** (already) — create a plan + tasks
2. **Task decomposition agent** — break one task into subtasks with dependencies
3. **Backlog triage agent** — prioritization, identify blockers, propose next actions
4. **Timeline agent** — fit tasks into a target date, propose schedule/critical path
5. **Status update agent** — weekly summary from tasks + activity log

#### B) Notes & knowledge agents
6. **Sticky notes clustering** — cluster/summarize notes per project
7. **RAG QA agent** — answer questions grounded in tasks/notes/comments

#### C) Communication agents
8. **Project chat helper** — suggest actions, drafts, “next steps”
9. **DM summarizer** — summarize a conversation and propose replies

#### D) Operations agents
10. **Org onboarding agent** — create templates/projects/tasks for new org
11. **Reminder agent** — draft reminders & notifications

#### E) Safety agents (optional)
12. **Moderation/safety classifier agent** — for chats/comments

---

## 2) What “best model” means for Kairos specifically

Your current agent pattern is:

1. Fetch context using tools (permission-checked DB reads/writes)
2. Build a prompt
3. Call [`chatCompletion()`](src/server/llm/core/modelClient.ts)
4. Parse JSON and validate via Zod
5. Optionally write back using tools

So the best model(s) for Kairos are those that:

- follow instructions reliably
- produce **valid JSON** under pressure
- handle long contexts (projects can have many tasks)
- perform decently on summarization + planning
- have licensing you can ship with

---

## 3) Model deep dive: free/open-weight candidates

### 3.1 Qwen2.5 Instruct (Apache 2.0)
**Why it’s strong for Kairos:** Qwen’s model card explicitly calls out structured outputs / JSON resilience and long context.

- Model card: https://huggingface.co/Qwen/Qwen2.5-7B-Instruct
  - Notes: highlights long-context support up to 128K and better structured output behavior.
- License (Apache 2.0 example): https://huggingface.co/Qwen/Qwen2.5-14B-Instruct/blob/main/LICENSE

**Recommended sizes:**
- 7B for cost-effective quality
- 14B if you can afford more VRAM/latency

**Best use cases:**
- Project planning, task triage, summarization, chat assistant

---

### 3.2 Phi models (Phi-3.5 / Phi-4 family)
#### Phi-3.5-mini-instruct (MIT)
**Why it matters:** It’s one of the best “small” models: strong reasoning *for size*, 128K context, permissive MIT license.

- Model card (includes benchmark tables and 128K context): https://huggingface.co/microsoft/Phi-3.5-mini-instruct
- License: https://huggingface.co/microsoft/Phi-3.5-mini-instruct/blob/main/LICENSE

**Key properties (from model card):**
- 3.8B parameters
- 128K context
- Focus on reasoning dense data

**Where Phi shines in Kairos:**
- summarization agents (status updates, note clustering)
- lightweight chat assistant
- can do planning, but may be less robust than 7B+ models for complex multi-step task decomposition

**Caution:** small models can hallucinate more; for “write back into DB” flows, keep `allowWrite=false` by default and require user confirmation.

---

### 3.3 Mistral NeMo Instruct (Apache 2.0)
**Why it’s relevant:** 12B is a sweet spot; 128K context; Apache 2.0.

- Source: https://mistral.ai/news/mistral-nemo

**Strengths:**
- multilingual
- long context
- strong general assistant

---

### 3.4 OLMo 2 (Apache 2.0)
**Why it’s relevant:** strong “open science” posture; Apache 2.0; good instruct variants.

- Model card: https://huggingface.co/allenai/OLMo-2-1124-7B-Instruct
- Project page: https://allenai.org/olmo

**Where it fits:**
- general agents, summarization
- if you value provenance and openness (datasets/logs)

---

### 3.5 DeepSeek-R1 (MIT) (reasoning-first)
**Why it’s relevant:** best-in-class open reasoning, plus distilled smaller models.

- Release note highlighting MIT: https://api-docs.deepseek.com/news/news250120
- HF model card: https://huggingface.co/deepseek-ai/DeepSeek-R1

**Caution:**
- “Full” R1 is huge (MoE); you likely want a **distilled** checkpoint for practical deployment.
- Also, R1 guidance suggests avoiding system prompts in some configurations; your architecture uses system messages. You can adapt prompts if needed.

---

### 3.6 Gemma 2 (open weights, but Terms of Use)
Gemma is capable, but licensing restrictions may be problematic depending on your product distribution.

- Terms: https://ai.google.dev/gemma/terms

---

## 4) Model selection matrix (Kairos-focused)

| Model | License | “Free to run” | JSON/structured output | Context | Best Kairos use | Notes |
|---|---|---:|---:|---:|---|---|
| Qwen2.5-7B Instruct | Apache 2.0 | Yes | High | 128K | Planning + triage + summaries | Best general default |
| Qwen2.5-14B Instruct | Apache 2.0 | Yes | High | 128K | Higher quality planning | More VRAM |
| Phi-3.5-mini-instruct | MIT | Yes | Medium-High | 128K | Cheap summaries + chat | Great for its size |
| Mistral NeMo Instruct (12B) | Apache 2.0 | Yes | High | 128K | Chat + planning | Strong all-round |
| OLMo-2 7B/13B Instruct | Apache 2.0 | Yes | Medium-High | (varies) | General agents | “Fully open” posture |
| DeepSeek-R1 (full) | MIT | Yes (but heavy) | Medium | 128K | Advanced reasoning | Use distilled instead |
| Gemma | Terms | Yes | High | (often 8K) | Chat/summaries | License complexity |

---

## 5) Recommendation: the best model for Kairos (practical)

### Best single default: **Qwen2.5-7B-Instruct**
**Why:**
- Apache 2.0 license is easy for most products.
- Strong instruction following + structured JSON generation (explicitly emphasized in model card).
- 128K context helps your agents scale with project history.

### Best “cheap” default: **Phi-3.5-mini-instruct**
**Why:**
- MIT license.
- 3.8B means cheaper inference.
- 128K context.

### Upgrade option: **Mistral NeMo Instruct (12B)**
**Why:**
- Apache 2.0
- Great long-context assistant

---

## 6) How to implement these in Kairos

Right now, the model client is a raw-`fetch`, OpenAI-compatible client with a model fallback chain: [`modelClient.ts`](src/server/llm/core/modelClient.ts).

To run “free models”, add additional `LLMClient` adapters that talk to local servers:

### A) OpenAI-compatible local server route (vLLM / LM Studio)
- Run vLLM or LM Studio with an OpenAI-compatible API.
- Implement `OpenAICompatibleLLMClient` that points to a base URL.

### B) Ollama route
- Run Ollama locally.
- Implement `OllamaLLMClient` via HTTP.

Then select the client based on env (see [`modelClient.ts`](src/server/llm/core/modelClient.ts) and `docs/agent-env-vars.md`), e.g. `LLM_BASE_URL`.

---

## 7) Sources (MCP)

- Qwen2.5 model card: https://huggingface.co/Qwen/Qwen2.5-7B-Instruct
- Qwen license (Apache 2.0): https://huggingface.co/Qwen/Qwen2.5-14B-Instruct/blob/main/LICENSE
- Phi-3.5-mini model card: https://huggingface.co/microsoft/Phi-3.5-mini-instruct
- Phi-3.5-mini license (MIT): https://huggingface.co/microsoft/Phi-3.5-mini-instruct/blob/main/LICENSE
- Mistral NeMo announcement (Apache 2.0): https://mistral.ai/news/mistral-nemo
- DeepSeek R1 release note (MIT): https://api-docs.deepseek.com/news/news250120
- DeepSeek R1 model card: https://huggingface.co/deepseek-ai/DeepSeek-R1
- OLMo 2 instruct model card (Apache 2.0): https://huggingface.co/allenai/OLMo-2-1124-7B-Instruct
- OLMo project page: https://allenai.org/olmo
- Gemma terms: https://ai.google.dev/gemma/terms
