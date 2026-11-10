# The KAIROS agent harness: what it does, where it breaks, and the plan

2026-11-09. Scope: everything between a user's message and a change in the
workspace — the orchestrator, A1 (Mentor) and its tools, the five write
specialists, handoffs, draft → confirm → apply → undo, conversation state, the
model layer, the scheduled agents, observability and the evals.

Decisions this plan is built on (asked 2026-11-09):

- **Model:** whatever works best, chosen by measurement, not by habit.
- **First goal:** a reliable thesis demo; fixes are made the way real use needs them.
- **Agents:** the six conversational agents and their names stay.
- **Lost work:** the A1 grounding and A4 event-time fixes reviewed on 2026-10-18
  never reached the repository and are redone here.

---

## 1. Verdict

The harness is carefully engineered *per component*: the model client's failover,
the tool loop's bounds and authorization, the confirmation tokens, the plan hashes
and the scheduled runner are better than most production code. It fails **between**
components. The places where one agent's output becomes another's input — A1 →
specialist, specialist → UI, user's answer → the agent that asked — have no
contract the code enforces, and each one loses work silently.

Five facts carry the verdict:

1. **The chat shows one plan per turn, but a turn can produce three.** Plans two and
   three are drafted, stored and, if small, *auto-applied* — and the user never sees
   them. ([`ProjectIntelligenceChat.tsx:1008`](../../src/components/projects/ProjectIntelligenceChat.tsx#L1008))
2. **Handoffs run in parallel, but the prompt says "in the order they should run".**
   "Create project School and add five tasks to it" cannot work: the task planner
   runs before the project exists. ([`handoff.ts:334`](../../src/server/llm/orchestrator/handoff.ts#L334), [`a1Prompts.ts:147`](../../src/server/llm/prompts/a1Prompts.ts#L147))
3. **Task requests route correctly 37.5 % of the time** (3/8), multi-agent requests
   50 %, overall 72.7 % on the 55-case golden set; p95 latency 52 s.
   ([routing eval 2026-09-25](../diploma/evals/a1-routing-2026-09-25-openai-gpt-oss-20b.md))
4. **No write is atomic.** No agent apply uses a transaction; status is checked at
   the start and set at the end, so a double click or a crash mid-apply leaves a
   partial change. Auto-apply can strand a draft in a state the Confirm button
   rejects.
5. **The top user-facing failure from the persona eval is still live.** Transliterated
   Bulgarian ("razbii otcheta za Erasmus…") is detected as Portuguese — reproduced
   today against `detectReplyLanguage`.

Everything runs on `openai/gpt-oss-20b` over NVIDIA's free tier, whose terms the code
itself records as forbidding personal data
([`providers.ts:80`](../../src/server/llm/core/providers.ts#L80)). Several fixes below
are model-independent; the model decision (§5.4) is the single biggest lever.

---

## 2. How a turn works today

```
user message
  └─ POST /api/ai/chat ─ rate limit (1 unit) ─ load last 10 turns + summary + page
       └─ runAgentTurn
            ├─ pinned agent?  → that specialist only
            └─ A1 tool loop (≤ 8 model calls, 26 tools, 90 s)
                 └─ JSON: answer | clarify | handoffs[≤3]
                      └─ each handoff, CONCURRENTLY:
                           specialist gets { userIntent, context{} } — nothing else
                           one model call over a pre-built context pack → plan
                           A2/A3: small plan may auto-apply (confirm+apply)
  └─ SSE: tool_call… answer_delta… sub_agent… result
  └─ after(): store user msg, A1 JSON + specialists' summary/questions; title; summary

UI renders payload.plan (the first) → Confirm → token (10 min) → Apply → Undo (10 min,
tasks and notes only)
```

Specialists never see the conversation. Everything they know comes from a paraphrase
a 20B model wrote (`userIntent`) and an untyped `context: Record<string, unknown>`
([`a1WorkspaceConciergeSchemas.ts:47`](../../src/server/llm/schemas/a1WorkspaceConciergeSchemas.ts#L47)).
When a specialist asks a question, the user's answer goes back to A1, which must
reconstruct the whole request again from history.

---

## 3. What to keep

Not every part needs work. These are sound and the plan builds on them:

- **Model client failover** (`core/modelClient.ts`): retry only what is retriable,
  first-byte timeout, demote-not-drop cooldowns, separate backup provider.
- **Tool loop safety** (`core/toolLoop.ts`): allowlist from the profile, every tool
  authorized with the caller's context, bounded iterations and wall clock, per-turn
  result cache, failures returned to the model as text.
- **Draft → confirm → apply** with HMAC confirmation tokens bound to user, draft and
  plan hash; scope and permissions re-checked at apply time; `clientRequestId`
  idempotency for task creation.
- **Auto-apply limits** (`agents/smallPlans.ts`): ≤ 3 changes, no deletes, nothing
  assigned to someone else, no open question, undo entitlement required.
- **Scheduled runner**: one authenticated tick, `lastRunAt` claimed in the database
  before work, Risk Radar as a query rather than a model call.
- **Page context** is resolved and access-checked server-side, never trusted from
  the client.
- **The eval harness** runs the product's own `runA1Turn`, prompt and parser — the
  right design; it needs wider coverage, not a rewrite.

---

## 4. Findings, ranked by harm

Each finding names the evidence. "Silent" means the user is not told.

### A. Handoffs (the core ask)

| # | Finding | Evidence | Harm |
|---|---|---|---|
| A1 | Only `plans[0]` is rendered; plans 2–3 appear as trail dots only. An auto-applied second plan changes data with no receipt and no Undo button. | `ProjectIntelligenceChat.tsx:1008`; `handoff.ts` returns up to 3 | silent data change |
| A2 | Handoffs run concurrently; dependent requests (project → tasks in it, event → note about it) cannot work. Prompt claims order matters. | `handoff.ts:334`, `a1Prompts.ts:147` | wrong / failed plan |
| A3 | Two handoffs to the same agent: the second is dropped. | `a1WorkspaceConciergeSchemas.ts:222` | silent loss |
| A4 | Handoff context is `Record<string, unknown>`; each specialist parses its own keys (`projectId` as number or string, `projectName`…). No shared contract, no validation. | schema `:47`; `a2TaskPlanner.ts:269-285` | brittle |
| A5 | Specialists see only `userIntent` + context, never the conversation; all continuity depends on A1's paraphrase (`a1Prompts.ts:131`). The persona audit: "A4 still sees only the current message, so the answer to its own date question arrives only through A1's paraphrase." | audit 2026-10-18 §2.4 | lost details |
| A6 | A specialist's question has no state: the answer goes to A1, which must recognise it and re-hand off. `followup-context` flapped in the audit. | `handoff.ts` `handoffReplies`; audit §3 follow-up | misroute |
| A7 | Each specialist re-resolves entities its own way. A2 matches project names by substring and silently picks a single hit ("Al" → "Alpha"), searching only the first 50 projects. | `a2TaskPlanner.ts:304` | wrong project |
| A8 | Raw internal errors reach the chat: `Invalid A2 plan JSON: <zod dump>` → `handoffErrors` → bubble text; the SSE `error` event forwards `err.message` too. Errors are shown only when no plan exists. | `a2TaskPlanner.ts:447`, `ProjectIntelligenceChat.tsx:1032`, `route.ts:170` | confusing |
| A9 | Task routing 37.5 %, multi 50 %, clarify 50 %, tool-argument validity 70.6 %. | routing eval 09-25 | wrong agent |

### B. Writes and undo

| # | Finding | Evidence |
|---|---|---|
| B1 | No apply in A2–A6 uses a transaction (`grep transaction( orchestrator/` → 0). A crash mid-apply leaves a partial change and a draft still `confirmed`. | `a2TaskPlanner.ts:942` comment admits it |
| B2 | Status is read at the start, `applied` written at the end, non-atomically: two concurrent Apply calls both pass. Creates are idempotent; updates, comments, deletes are not. | `a2TaskPlanner.ts:1190` |
| B3 | Auto-apply runs confirm, then apply; if apply throws, the draft stays `confirmed` and the UI's Confirm then fails "not confirmable". The comment says it is "left exactly as drafted". | `autoApply.ts:70` |
| B4 | Undo writes the before-image back without checking that nobody changed the row since — it can overwrite a teammate's edit. | `undo.ts` (no version check) |
| B5 | Undo covers tasks and notes only. Events, projects, invites, role changes and member removals cannot be undone. | `undo.ts` imports |
| B6 | The lifecycle is implemented five times (A2–A6 each mint/read tokens and flip status). Every fix above must be made five times unless it is unified. | `orchestrator/a[2-6]*.ts` |

### C. Model layer, prompts, cost

| # | Finding | Evidence |
|---|---|---|
| C1 | `now: new Date().toISOString()` (ms precision) is inside A1's system prompt, so the prefix differs on every request and provider caching never hits — while the code comment claims the prompt is cached. | `a1ContextBuilder.ts:121` |
| C2 | JSON is enforced by prompt + repair. The repair prompt sees neither the schema nor the conversation, so it can fix a brace but must guess a missing field. | `jsonRepair.ts:143` |
| C3 | A tool result over 12 000 chars is cut mid-JSON and fed to the model as broken JSON. | `toolLoop.ts:155` |
| C4 | Running out of tool iterations returns "The AI assistant is temporarily unavailable" — the wrong reason; the model worked, the turn was too long. | `a1Concierge.ts:239` |
| C5 | A1 has 26 tools, four of which write (remember/forget a fact, schedule/cancel a reminder) — heavy for a 20B model, and the "A1 is read-only" claim in the README and thesis is not exact. | `profiles/a1WorkspaceConcierge.ts` |
| C6 | The budget counts one unit per turn; each specialist's first model call, the title and the summary are not counted. A three-handoff turn is ≈ 5+ calls billed as 1. | `route.ts:167`, `jsonRepair.ts` records only retries |
| C7 | `AgentId` still lists four agents. | `shared.ts:42` |
| C8 | Free-tier model: personal data forbidden by terms, p95 52 s, 254–454 s outliers in the audit. | `providers.ts:80`, audit |

### D. Language and grounding (from the persona eval)

| # | Finding | Evidence |
|---|---|---|
| D1 | Transliterated Bulgarian → Portuguese or no language, and the directive then *forbids* Cyrillic. Still reproduces. | `replyLanguage.ts:253`, probe 2026-11-09 |
| D2 | A1 invents projects, merges two people with the same first name, never declines "send an email" — fixed on a branch that was lost. | audit §3 |
| D3 | A4 stores 10:00 as 10:00 UTC, "next Thursday" → a Monday, invents missing dates — fixed on a branch that was lost. | audit §2 |
| D4 | A2 re-creates tasks that already exist (3 of 5–6 in both runs). | persona findings #5 |

### E. Observability and evaluation

| # | Finding | Evidence |
|---|---|---|
| E1 | No turn id ties A1's calls, the specialists' calls and the repairs together; per-call logs exist but a turn cannot be reconstructed. | grep `turnId|traceId` → none |
| E2 | `ai_messages` has `model`/`promptTokens`/`completionTokens` columns that the observability page reads, but the chat route stores only `latencyMs`. The dashboard reads empty columns. | `route.ts` `appendMessage` call |
| E3 | No eval exercises the real path: A1 → handoff context → specialist → plan → what the UI renders. The live evals test A1's routing decision and drive A2/A4 directly. | `tests/agents/evals/*`; audit §1 "known limits" |
| E4 | Eval runs are n = 1–2 on one free model; one case moves a category by 14–50 points. | routing eval |

---

## 5. The plan

Six workstreams, in dependency order. Each item has an acceptance test; nothing is
"done" until its test exists and passes. Rough sizes: S ≤ ½ day, M 1–2 days,
L 3–5 days.

### 5.0 Measure first (week 1)

Nothing below can be called better without a baseline that measures the path users
take.

1. **End-to-end eval through `runAgentTurn`** (M). Same stub workspace as the persona
   eval, but each case asserts the *rendered outcome*: which plans exist, their
   operations, which entities they target, what the user is asked, the reply
   language. Grade four things per case: routing, plan correctness, entity
   correctness, language. Include multi-turn cases (specialist asks → user answers).
2. **Cases from the failures above** (S): dependent handoffs (A2), same-agent split
   (A3), ambiguous project names (A7), латиница (D1), event times (D3), duplicates
   (D4), long lookups (C4), and every misroute in the 09-25 table.
3. **Repeat runs and report spread** (S): n ≥ 3 per case, report mean and min, not
   one run. Store every run's JSON (the 09-25 per-case JSON was overwritten).
4. **Contract test for the UI payload** (S): a component test that a turn with three
   plans renders three cards and that `handoffErrors` show beside a plan.

Acceptance: one command produces a dated report with routing, plan, entity and
language scores and p50/p95 latency; the current model's numbers are the baseline.

### 5.1 Stop the silent failures (week 1–2)

Small, independent, each removes a way the user loses work without being told.

1. **Render every plan** (M) — A1. One card per plan, in A1's order, each with its own
   Confirm/Undo; an auto-applied plan always shows its receipt. Errors from failed
   handoffs render as a friendly line beside the plans that succeeded.
   *Test:* 5.0.4.
2. **Friendly, localized errors** (S) — A8, C4. Specialists throw typed errors
   (`needs_project`, `invalid_plan`, `out_of_scope`, `timeout`); the route maps
   them to localized text; raw messages go to logs only. Tool-budget exhaustion
   gets its own message ("that needed more lookups than I can do in one turn —
   try narrowing it") instead of "unavailable".
3. **Same-agent handoffs merge, never drop** (S) — A3. Two handoffs to one agent
   become one whose `userIntent` joins both; the eval case asserts both halves
   reach the plan.
4. **Fix the auto-apply stranding** (S) — B3. If apply fails after confirm, put the
   draft back to `draft` (or make Confirm accept an already-confirmed draft owned by
   the caller and re-mint the token). *Test:* inject an apply failure, then confirm
   from the UI.
5. **Stable prompt prefix** (S) — C1. Round `now` to the day in the system prompt and
   send the exact time in a late message, like page context already is; the same
   for memory and the project list (move them after the static rules). *Test:*
   two consecutive A1 requests have byte-identical system prompts.
6. **Truncate tool results structurally** (S) — C3. Trim arrays (keep the first N rows,
   add `{ truncated: true, total }`) so the model always gets valid JSON.
7. **Count every model call** (S) — C6. Record specialists' first calls, title and
   summary against the budget (or a separate background budget, as scheduled
   agents already have). Persist model and token usage on the assistant row (E2).

### 5.2 A typed handoff contract (week 2–3) — the core of "flawless"

The idea: A1 decides **who** and **what**; the server resolves **which records**; the
specialist gets a complete, typed brief and never has to guess.

1. **`HandoffEnvelope` schema** (M) — A4, A5. Replace `context: Record<string, unknown>`
   with a validated object:
   ```ts
   {
     targetAgent, userIntent,              // as today
     originalMessage, replyLanguage,       // language pinned once, server-side
     entities: [{ kind, id, name, resolvedBy: "page"|"id"|"exact-name"|"search" }],
     openQuestion?: { askedBy, question, answer },  // see 5.2.3
     excerpt: last N user/assistant turns relevant to this agent, as plain text,
     dependsOn?: handoffIndex,             // see 5.2.4
   }
   ```
   The model fills `userIntent`, `targetAgent` and *names*; the server fills ids,
   language and the excerpt. Specialists read only the envelope.
2. **One entity resolver** (M) — A7. A server function used by every specialist and
   by A1's grounding: page context → explicit id → exact name → normalized exact
   name → search. Never a silent substring pick: more than one candidate or a
   fuzzy-only hit returns candidates, which become a clarify with real options.
   Searches all projects the user can reach, not the first 50.
3. **Pending-question state** (M) — A6. When a specialist asks, store
   `{ agent, draftContext, question }` on the conversation. The next user message is
   first offered to that agent (with the stored context and the answer), and A1 is
   consulted only if the message is clearly something else (a cheap classification,
   or the user tapped an option). This removes the paraphrase hop that loses
   details, and it is where most "it forgot what I said" failures live.
4. **Dependent handoffs** (L) — A2. Two kinds:
   - **Independent** (different domains, no shared new entity): run concurrently, as
     today.
   - **Dependent** (B needs something A creates): A1 marks `dependsOn`; B's plan is
     drafted with a placeholder reference (`project:new#1`) and shown as one
     combined card ("Create project School, then 5 tasks in it"); Apply runs A, then
     B with the real id, in one transaction (see 5.3). Simpler first step if L is too
     much for the demo: draft A, and offer B as a follow-up chip that runs once A is
     applied.
   *Test:* "create project School and add five tasks" yields one reviewable change
   that, applied, leaves a project with five tasks.
5. **Specialists may look things up** (M) — A5, D4. Give each write agent 2–4 read
   tools from A1's set (e.g. A2: `listTasks`, `searchWorkspace`), through the same
   tool loop with the same allowlist. A2's duplicate check then reads the real task
   list instead of a fixed context slice.

Acceptance (end-to-end eval): routing ≥ 95 %, entity correctness ≥ 98 %, zero
silent drops (every requested part is either in a plan or in a stated error), and
multi-turn completion ≥ 90 %.

### 5.3 One plan lifecycle engine (week 3–4)

1. **Shared engine** (L) — B6. One module owning draft persistence, confirm, token,
   apply, auto-apply, undo and expiry; each agent supplies only
   `validate(plan)`, `authorize(op)`, `apply(op, tx)` and `capture(op)` for undo.
   The five copies shrink to their domain logic.
2. **Atomic transitions** (M) — B1, B2. Apply = one transaction: `UPDATE drafts SET
   status='applying' WHERE id=$1 AND status='confirmed' RETURNING` (exactly one
   caller wins), all operations, before-image, apply row, then `applied`. A failure
   rolls everything back and returns the draft to `confirmed` with the error.
3. **Idempotency for every operation** (S) — B2. Extend `clientRequestId` beyond
   creates: an apply row keyed by draft id makes a second apply a no-op that returns
   the first result.
4. **Undo with conflict detection** (M) — B4, B5. Store each touched row's
   `updatedAt` at apply time; undo restores a row only if it is unchanged since, and
   reports the rest ("2 restored, 1 changed by Maria since — left as is"). Extend
   undo to events and projects; for membership (invites, roles, removals) store the
   inverse operation and offer undo where the inverse is safe.

Acceptance: concurrency test (two simultaneous applies → one result, one no-op);
crash test (fail mid-apply → no partial change); undo-after-teammate-edit test.

### 5.4 The model layer (week 2, in parallel with 5.1)

The question is which model makes the harness reliable, so it is settled by the
end-to-end eval, not by preference.

1. **Bake-off** (M). Run the 5.0 eval (n ≥ 3) on each candidate, same prompts:
   - the current `gpt-oss-20b` (baseline);
   - Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10 per M tokens) and Claude
     Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50) — current Anthropic models;
   - the existing presets that already have code: DeepSeek V4 Flash, Gemini Flash.
   Score routing, plan and entity correctness, language, p50/p95 latency and cost
   per *completed* turn. Pick the cheapest model that clears the 5.2 bars, with a
   second, different-provider model as backup.
2. **Native adapter where it pays** (M). The client speaks only OpenAI-compatible
   `/chat/completions`. If a Claude model wins, add a lane on the official
   `@anthropic-ai/sdk` rather than a compatibility shim, so the harness can use what
   removes whole failure classes: schema-constrained output (`output_config.format`)
   instead of prompt-and-repair (C2), `strict: true` tool arguments (tool-argument
   validity was 70.6 %), prompt caching with a stable prefix (C1), and
   mid-conversation system messages for the per-turn language and page directives.
   Whichever provider wins, use its native structured-output mode if it has one.
3. **Tiers by job** (S). Routing and planning on the chosen model; titles, summaries
   and repair on the cheap tier (already supported by `tier: "fast"`).
4. **Data terms** (S). The free NIM tier forbids personal data; whatever runs the demo
   with real-looking data must allow it. Record the choice in the thesis (§2.8.11).

Rough cost at the measured ~8 600 tokens per turn: about $0.02 per turn on Sonnet 5.5
and about $0.001 on Haiku 5.5 — a thesis demo and evaluation together cost a few
dollars. (Estimate; the bake-off measures it.)

### 5.5 Redo the lost fixes (week 2)

Re-implement from the audit's description, with its review comments already applied
(audit 2026-10-18 §2–3 and the 10-19 follow-up):

1. **A1 grounding** (M) — D2: drop clarify options that name nothing real; force a
   clarify for a first name shared by two members (capitalized occurrences only, so
   "надежда" and "Слава богу" do not trigger); decline send-email/SMS only when the
   model handed off or asked for an address, worded "I can't send messages for you";
   locked notes searchable by title only; mark a truncated project list and search
   before saying a project does not exist. Most of this belongs in the entity
   resolver (5.2.2) rather than as a post-hoc rewrite.
2. **A4 event times** (M) — D3: the model writes wall-clock time, the server converts
   with a DST-aware `Europe/Sofia` conversion; the prompt gives today's date and a
   seven-day weekday table; a missing day or region becomes a question, never an
   invented value. Re-measure A4 latency (39 s in the audit).
3. **латиница** (S) — D1: recognise transliterated Bulgarian (common Bulgarian words
   and letter patterns in Latin script: "zadacha", "proekt", "sht", "q" for я) and
   map it to Bulgarian; when detection is not confident, never forbid the user's
   locale script — fall back to the saved locale.
4. **A2 duplicate guard** (S) — D4: compare drafted titles with existing tasks
   (normalized, fuzzy), drop or flag near-duplicates before the plan is shown.

Acceptance: the persona eval's C1, C2, C5, C6 and C7 pass on two runs.

### 5.6 Observability (week 3)

1. **Turn id** (S) — E1: one id generated per turn, passed to every model call,
   tool call and draft, logged and stored on the assistant row.
2. **Turn record** (M): per turn — route chosen, handoffs, plans, which were shown,
   confirmed, applied, undone, errors, model per call, tokens, latency per stage.
   This is the "handoff funnel": asked → routed → drafted → shown → applied → kept.
3. **Developer view** (S): the existing tool inspector reads the turn record, so a bad
   turn in the demo can be explained on screen.

---

## 6. Thesis demo track

What must be true before the defense, in order:

1. 5.0 (the eval that measures it) and 5.1 (no silent failures).
2. 5.4.1 bake-off and the switch to the chosen model — the largest single quality
   gain, and it removes the personal-data problem.
3. 5.5 (lost fixes) and 5.2.2–5.2.3 (entity resolver, pending questions) — these are
   what a live demo in Bulgarian would expose.
4. 5.3.2 atomic apply — a demo double click must not create a half change.
5. Rehearse a fixed demo script as an eval case set, run n ≥ 5 before the defense.

The evaluation chapter (§2.13) then reports end-to-end numbers on the path users
take, with spread, on the chosen model against the old baseline. 5.2.4 (dependent
handoffs) and 5.3.4 (undo everywhere) are good "future work → done" material if they
land, and honest limitations if they do not.

---

## 7. What I doubted and could not settle

- **Whether plans 2–3 ever reached users.** The UI drops them; how often A1 actually
  emits more than one handoff in real use is unknown — the stored conversations
  would tell (`ai_messages` with `handoffs` length > 1).
- **Stale drafts.** The token expires in 10 minutes, but no code ever sets an agent
  draft to `expired` (the only `expired` writes are for org invites), so `draft` and
  `confirmed` rows accumulate. Harmless for correctness — apply re-checks the token —
  but the lifecycle engine (5.3) should own expiry.
- **The eval numbers are small samples** on one free model; they show direction, not
  precise rates. The bake-off must use n ≥ 3.
- **Prompt-injection exposure in write agents.** A1's handling held in the persona
  eval (2/2). Specialists' context packs also contain teammates' text and a small
  plan can auto-apply; bounded by the small-plan rules and undo, but not tested.
- **Model prices and capabilities** come from Anthropic's model table as of this
  week and the repo's own provider research; verify before committing to a provider.

---

## 8. Open questions for the author

1. Is a demo budget of a few dollars of API usage acceptable, and which account pays?
2. For dependent handoffs (5.2.4), is the full "one combined plan" worth it before the
   defense, or is "apply the first, then offer the second" enough?
3. Should membership changes (remove member, change role) be undoable at all, or
   stay confirm-only by design?
