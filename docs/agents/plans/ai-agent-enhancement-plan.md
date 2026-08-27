# KAIROS AI & Agent Enhancement Plan

Date: 2026-08-21
Status: proposal
Scope: `src/server/llm/**`, `src/app/api/ai/**`, `src/components/chat/**`, agent-adjacent DB schema

> **Shareable version:** [`kairos-agent-roadmap.html`](../kairos-agent-roadmap.html) —
> the same plan as a single designed page, published at
> <https://claude.ai/code/artifact/1d47f112-6393-444e-9c00-debe0d62a9ae>.

---

## 0. Baseline — what already exists

The plumbing is in better shape than most shipped AI features. Before proposing anything, here is what is actually built:

| Capability | Where | State |
|---|---|---|
| A1 Workspace Concierge (read-only, tool loop) | `src/server/llm/orchestrator/a1Concierge.ts` | Live, 8 read tools |
| A2 Task Planner (draft → confirm → apply) | `orchestrator/a2TaskPlanner.ts` | Live |
| A3 Notes Vault (lock-aware) | `orchestrator/a3NotesVault.ts` | Live |
| A4 Events Publisher | `orchestrator/a4EventsPublisher.ts` | Live |
| A5 Org Admin | — | **Routed but not implemented** — handoff dead-ends |
| Server-side routing (A1 → sub-agent, one request) | `orchestrator/handoff.ts` | Live |
| Confirmation tokens (HMAC + SHA-256 plan hash) | `orchestrator/shared.ts` | Live |
| Bounded tool loop (allowlist, dedupe cache, 6 iters, 90s) | `core/toolLoop.ts` | Live |
| Model client (retry, backoff, fallback chain, truncation detection) | `core/modelClient.ts` | Live |
| SSE progress streaming | `src/app/api/ai/chat/route.ts` | Live |
| Conversation persistence with token/latency columns | `conversations.ts`, `db/schemas/agents.ts` | Live |
| Zod validation + AI-assisted JSON repair | `core/jsonRepair.ts` | Live |
| Sliding-window rate limit, Redis-backed | `security/rateLimit.ts` | 50/user/day |
| PDF → tasks pipeline | `pdf/pdfExtractor.ts`, `orchestrator/taskGeneration.ts` | Live |

The gaps are not in the plumbing. They are in **reach**, **initiative**, **memory**, and **proof**.

---

## 1. The four gaps

### Gap 1 — Reach: the agent can barely see the workspace

A1 has exactly eight read tools. It cannot search anything. It cannot read a task comment, a note, an org member list, a calendar range, a project collaborator, an event RSVP, or the task activity log.

Concretely unanswerable today:

- "Where did we discuss the payment flow?"
- "Who on the team is overloaded this week?"
- "What changed on task 42 since Monday?"
- "What's due between Monday and Friday, across all my projects?"

### Gap 2 — Initiative: the agent never speaks first

Every AI action in KAIROS begins with a human typing. There is no brief, no watch, no nudge. Worse, **there is no server-side scheduler at all** — `EventReminderService.tsx` is a `"use client"` component running `setInterval` in the browser, so even event reminders only fire while someone has a tab open.

For a product named after the opportune moment, an assistant that only ever reacts is contradicting its own name.

### Gap 3 — Memory: it forgets everything

- History is the last 16 messages replayed raw. No summarization, so long threads either lose the beginning or blow the context budget.
- `ai_conversations.title` exists in the schema and **is never written** — there is no conversation list, only `findLatestConversation`.
- No durable facts. Ask the same thing tomorrow and the agent starts from zero. It does not know your sprint runs Mon–Fri or that you want tasks written in Bulgarian.

### Gap 4 — Proof: nothing measures whether it is good

- One AI test file exists: `tests/agents/jsonRepair.test.ts`.
- No eval set, no routing-accuracy metric, no schema-validity rate.
- `ai_messages` stores `model`, `promptTokens`, `completionTokens`, `latencyMs` on every row — and **nothing reads them**.
- `citations` is in `A1OutputSchema`, the model produces them, and the UI renders them nowhere.

The comment at the top of `a1Prompts.ts` records a prompt that "contradicted itself" and was "spending budget to make the output worse." That was found by reading. Evals are how it gets found automatically next time.

Plus: five UI locales shipped, two agent languages supported.

---

## 2. The plan

### Track A — Reach: give the agent eyes

**A-1. `searchWorkspace` tool.** Postgres full-text search (`tsvector` + GIN index) across tasks, projects, unlocked notes, events, and comments. No new infrastructure, no new dependency. One tool, the single largest capability unlock available.

- New: `src/server/llm/tools/shared/searchTools.ts`
- Schema: generated `tsvector` columns + GIN indexes on `tasks`, `projects`, `sticky_notes`, `events`
- Register in `tools/a1/toolDefinitions.ts` and the A1 profile allowlist
- **Locked notes stay excluded at the query level**, matching the existing three-layer rule

**A-2. Expand the read-tool surface** from 8 to ~18:

| Tool | Question it makes answerable |
|---|---|
| `searchWorkspace` | "Where did we discuss the payment flow?" |
| `listMyWork` | "What's on my plate this week?" (cross-project, assigned to me, by due date) |
| `getWorkloadByAssignee` | "Who's overloaded?" |
| `listTaskComments` | "What has the team said about this?" |
| `getTaskActivity` | "What changed on task 42 since Monday?" |
| `listOrgMembers` | "Who's in the Design org and what's their role?" |
| `listProjectCollaborators` | "Who can edit this project?" |
| `getCalendarRange` | "What's due Mon–Fri?" (wraps existing `calendar.getForRange`) |
| `listNotesMetadata` | "Do I have notes about X?" (share A3's tool with A1, metadata only) |
| `listEventRsvps` | "Who's coming to the kickoff?" |
| `getProjectHealth` | Computed risk metrics — velocity, overdue clusters, unassigned share |

Keep the design rule that already works: **tools return computed answers, not rows for the model to count.** `getProjectDetail` already returns pre-computed task and overdue counts, and that is why progress questions work. Extend that way.

**A-3. Raise the loop ceiling.** `DEFAULT_MAX_ITERATIONS = 6` is tight once eighteen tools exist. Raise A1 to 8, and execute independent read calls in parallel — the sequential comment in `toolLoop.ts` cites a shared connection pool and id dependencies, both of which only apply to calls that chain. Batch the ones that do not.

---

### Track B — Initiative: the agent that speaks first

This is the headline. It is what separates "a chatbot in the corner" from "an assistant".

**B-0. A scheduler, first.** Nothing in Track B is possible without one. Options, in order of preference:

1. **`ws-server/` gains a scheduler.** It is already a long-lived Node process with DB access and a socket channel to push results. Least new infrastructure.
2. Vercel Cron hitting an authenticated internal route.
3. A separate worker process.

Recommendation: option 1. It also fixes the browser-only `EventReminderService` as a side effect.

**B-1. Daily Brief (new agent: A6 — Briefing Agent).** Per-user, generated on a schedule. Read-only, so it skips the draft/confirm/apply lifecycle entirely and reuses A1's tool registry.

> "3 tasks due today. Project Alpha slipped 2 days — the API work is the blocker. Maria has not been assigned anything this sprint. The kickoff event has 4 unanswered RSVPs."

Delivered as a notification, a dashboard card, and optionally email (Resend is already wired).

**B-2. Risk Radar.** A scheduled pass over each active project flagging: overdue clusters, unassigned tasks, tasks with no acceptance criteria, a project whose completion rate has flatlined, an event with a date but no description. Emits notifications — never writes.

**B-3. Nudges that arrive pre-drafted.** Every proactive item ships with a *drafted fix*, not just a complaint:

> "Task #42 is 6 days overdue and unassigned → assign to Ivan, push to Friday?" **[Apply]**

The draft/confirm/apply machinery already supports this exactly as-is. The only change is that a watcher creates the A2 draft instead of a chat turn creating it. This is the feature that makes the system feel like it is working for you.

**B-4. Quota and consent.** Proactive runs must not eat the interactive budget:

- New table `ai_schedules` — `(userId, kind, cron, enabled, lastRunAt)`
- Split the rate limit into **interactive** and **system** buckets
- Settings → AI toggle per proactive feature, **off by default**

---

### Track C — Memory: an assistant that knows you

**C-1. Rolling conversation summary.** Past 16 turns, summarize the oldest half into `ai_conversations.summary` and replay `summary + last 8`. Keeps long threads coherent instead of truncating their beginning.
*Files:* `conversations.ts`, new column on `ai_conversations`.

**C-2. Durable user facts** — new table `ai_user_memory`, small and typed:

> "Sprint runs Mon–Fri." · "Wants tasks written in Bulgarian." · "Treats 'urgent' as within 48 hours."

Rules that keep this trustworthy:

- Written only through an explicit `rememberFact` tool, triggered by the user actually saying to remember something — never silently inferred
- Every row visible and deletable in **Settings → AI Memory**
- Injected as a short block in the system prompt, capped at ~20 facts

This is the cheapest change on the list with the largest effect on whether the thing feels like an assistant.

**C-3. Conversation titles and a history browser.** Generate `title` from the first turn with one cheap call (the column is already there, just unwritten), then list past conversations in the chat sidebar with search.

---

### Track D — Ambient AI: meet the work where it happens

AI currently lives at `/chat` and in a floating widget. Everything below is a pre-filled `runAgentTurn` call with a seeded message and scope — no new plumbing.

**D-1. Inline affordances**

- **Task detail** → "Break into subtasks" · "Draft a status comment" · "Why is this blocked?"
- **Project page** → "Risk radar" panel, on demand
- **Note** → "Summarize" · "Turn into tasks" (A3 → A2 chain)
- **Event** → "Draft the description" · "Find a time that clears the team's calendar"
- **Notification bell** → "Summarize what I missed"

**D-2. Command palette (⌘K) with natural language.** Type anything; if it does not match a navigation target, it becomes an agent turn. Highest leverage per line of code in this document.

**D-3. Selection → AI.** Select text anywhere — a note, a project description — and get "Turn into tasks / Summarize / Translate".

---

### Track E — Composition: multi-step work and asking back

**E-1. Add a `clarify` intent.** `ConciergeIntentSchema` currently allows `answer | handoff | draft_plan`. An ambiguous request today produces a guess. Add `clarify`: one question back plus 2–4 suggested chips. Good assistants ask; they do not guess.

**E-2. Multi-agent turns.** `runAgentTurn` executes exactly one handoff. "Break down Project Alpha, note the risks, and schedule the kickoff" needs three. Change `handoff` to an ordered `handoffs[]` (max 3), run them sequentially, return an array of plans, render stacked confirm cards. Bounded, and still one request.

**E-3. Refinement turns.** After a draft, "change #3's due date to Friday and drop #7" should re-draft *against the existing plan*, not start over. Pass the current plan in as `priorPlan` and re-hash — the confirm token is already minted from the hash, so integrity holds automatically.

**E-4. Finish A5 Org Admin.** Routing exists; the handoff currently returns "The org_admin agent is not available yet." Same lifecycle as A2/A3/A4, plus one extra rule: every write is `dangerous: true` and requires typed confirmation, because role changes have long-tail consequences. Already specced in `docs/agents/5-org-admin.md`.

---

### Track F — Proof: make quality measurable

**F-1. Eval harness.** 60–100 golden cases in `tests/agents/evals/`:

```ts
{ message: "add three tasks for the login page",
  expect: { intent: "handoff", targetAgent: "task_planner" } }
```

Run against recorded fixtures in CI (fast, free) and against the live model on demand. Two metrics matter:

- **Routing accuracy** — did A1 pick the right agent?
- **Schema validity rate** — how often does `jsonRepair` have to fire?

Until this exists, every prompt edit is a coin flip.

**F-2. Authorization regression tests.** For every read tool, assert it fails closed for a non-member. Audit finding **P0 #1** was exactly this class of bug ("AI agent reads and writes any project by ID"). One test per tool prevents its return.

**F-3. AI observability page** (admin only). Every number below is already stored in `ai_messages` and currently unread: p50/p95 latency per agent, tokens per day, repair rate, tool failure rate, exhausted-loop rate, top failing tools.

**F-4. Model tiering.** One chain serves everything today. Route by job — a small, cheap model for classification, title generation, and JSON repair; the strong model for planning and analysis. `chatCompletion` already accepts `model`; add a `tier` parameter resolved from a new `LLM_MODEL_FAST` env var.

---

### Track G — Polish users feel immediately

**G-1. Stream the answer text.** Today only *progress* streams; the answer lands as one blob after up to 90 seconds. Split A1's response so `answer.summary` streams as text and the structured envelope (handoff, citations, draftId) arrives last. Perceived latency is the number one complaint against reasoning models.

**G-2. Language parity.** Five agent languages to match five UI locales, driven by the user's saved `languageEnum` preference rather than the prompt guessing from the message text. `a1Prompts.ts` currently hardcodes "English or Bulgarian."

**G-3. Citations that click.** The model already emits `{label, ref}` and the UI drops them on the floor. Render each as a deep link (`task:42` → `/tasks/42`). Trust comes from being able to check the answer.

**G-4. Suggested follow-ups.** Two or three next questions returned with each answer — same call, one extra field. It is what keeps people using an assistant.

**G-5. Undo.** Every apply already writes to an `*_applies` table with a result JSON. Add "Undo" for 10 minutes after apply, reversing creates by id. The confidence to press **Apply** comes from knowing you can take it back.

---

## 3. Sequencing

| Phase | Focus | Items | Rough duration |
|---|---|---|---|
| **1 — Foundation** | See more, prove more | A-1, A-2, F-1, C-1, G-2 | 2–3 weeks |
| **2 — Initiative** | The headline feature | B-0, B-1, B-2, B-3, B-4, C-3 | 3–4 weeks |
| **3 — Depth** | Real conversations | E-1, E-2, E-3, E-4, G-5 | ~3 weeks |
| **4 — Ambient + proof** | Everywhere, and measured | D-1, D-2, F-3, F-4, G-1, G-3, G-4 | ~2 weeks |

Phase 1 comes first for one reason: everything downstream improves when the agent can see more, and **the eval harness has to exist before prompts start changing**, or every later phase silently regresses the earlier ones.

---

## 4. Risks and decisions to make

**Background jobs need a home.** Next.js route handlers do not run on a schedule. Decide between the `ws-server/` scheduler, Vercel Cron, and a separate worker *before* Phase 2 starts. This blocks all of Track B.

**Full-text search vs. embeddings.** Postgres FTS is free, needs no new extension, and works today. pgvector adds semantic recall ("that thing about payments") at the cost of an embedding call per write plus a new extension. **Recommendation:** ship FTS in Phase 1, then measure what search actually misses before deciding whether vectors earn their keep.

**Proactive AI is a spend multiplier.** One brief per user per day is a fixed daily cost with no human in the loop to justify it. Gate behind explicit opt-in and an org-level quota.

**Proactive AI is also a trust risk.** An assistant that is wrong when you asked it is annoying. One that is wrong unprompted is noise you switch off permanently. Ship Risk Radar behind a flag and track dismissal rate as the primary metric.

**The 50/day limit will bite.** A multi-agent turn costs three to five model calls. Meter by *calls*, not by *messages* — `recordExtraAiCall` already exists for the tool loop; extend it to the draft and handoff paths.

**The docs have drifted.** `docs/agents/kairos-agents-overview.md` describes code at `src/server/agents/`, which is now `src/server/llm/`. Fix during Phase 1 or the plan inherits the confusion.

---

## 5. If there were only one week

1. **`searchWorkspace`** — the largest capability gain per line of code in this document.
2. **Eval harness, 40 routing cases** — turns prompt work from guesswork into engineering.
3. **Daily Brief for one user, behind a flag** — the demo that makes someone say "that is not a chatbot."
