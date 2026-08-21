# AI & Agent Enhancement — what shipped

Date: 2026-08-21
Plan: [`ai-agent-enhancement-plan.md`](plans/ai-agent-enhancement-plan.md)

Implements all seven tracks of the plan. This document is the map from plan item
to code, plus the setup steps the new features need.

> **Note on paths.** `docs/agents/kairos-agents-overview.md` still describes the
> agent code as living under `src/server/agents/`. It has been at
> `src/server/llm/` for some time; that document is stale and everything below
> uses the real paths.

---

## Setup required before any of this runs

**1. Push the schema.** Six new tables and one new enum:

```bash
pnpm db:push
```

| Table | For |
|---|---|
| `ai_user_memory` | C-2 durable facts |
| `ai_schedules` | B-4 proactive opt-in |
| `ai_findings` | B-2/B-3 risk radar |
| `agent_org_admin_drafts` | E-4 A5 |
| `agent_org_admin_applies` | E-4 A5 |
| *(columns)* `ai_conversations.summary`, `.summarized_through_id` | C-1 |

**2. Create the search indexes** (optional — search is correct without them, just
slower):

```bash
psql "$DATABASE_DIRECT_URL" -f scripts/sql/search-indexes.sql
```

**3. Run the ws-server** if you want proactive AI. It holds the scheduler and
calls the app every five minutes. Nothing fires until a user opts in under
**Settings → AI assistant**.

```bash
pnpm ws:dev
```

**4. Optional env**: `LLM_MODEL_FAST` (cheap tier), `AI_SYSTEM_RATE_LIMIT`
(proactive budget, default 20/day).

---

## Track A — Reach

| Item | Where |
|---|---|
| A-1 `searchWorkspace` | `src/server/llm/tools/a1/searchTools.ts` |
| A-2 ten new read tools | `src/server/llm/tools/a1/workspaceTools.ts` |
| Shared visibility helper | `src/server/llm/tools/a1/scope.ts` |
| Tool names + shape | `src/server/llm/tools/a1/types.ts` |
| A-3 loop ceiling 6 → 8, parallel reads | `src/server/llm/core/toolLoop.ts` |

The tool surface went from 8 to 21. `searchWorkspace` uses Postgres full-text
(`simple` configuration, because five locales) OR `ILIKE` for prefixes. Locked
notes are excluded **in SQL**, before content is ever loaded.

`toolLoop` now runs the calls from one model turn concurrently, capped at 4. This
is safe because a model emits every call in a response *before* seeing any
result, so nothing in one batch can depend on anything else in it; chaining still
happens across iterations, which stay sequential.

## Track B — Initiative

| Item | Where |
|---|---|
| B-0 scheduler | `ws-server/scheduler.ts`, called from `ws-server/index.ts` |
| Internal endpoint | `src/app/api/internal/ai/run-schedules/route.ts` |
| B-1 A6 Briefing Agent | `src/server/llm/scheduled/dailyBrief.ts` |
| B-2/B-3 Risk Radar + fixes | `src/server/llm/scheduled/riskRadar.ts` |
| Orchestration | `src/server/llm/scheduled/runner.ts` |
| Synthetic context | `src/server/llm/scheduled/systemContext.ts` |
| B-4 quota split | `src/server/security/rateLimit.ts` |
| UI | `src/components/dashboard/AiInsightsPanel.tsx` |

**Why the clock and the work are in different processes.** The agent layer is
`server-only` and belongs to the Next.js runtime; the only long-lived process is
the socket server. Rather than duplicate the agents there, the scheduler makes an
authenticated HTTP call inward using the `WS_SECRET` the two processes already
share. This also fixes the browser-only `EventReminderService` as a side effect.

**Detection is deterministic, not a model call.** "Six tasks are overdue" is a
`COUNT`. The model's job is to turn findings into a sentence worth reading, which
means the radar still runs when a user's AI budget is spent, and a finding is
reproducible.

**Safety of the synthetic context.** `systemContextFor` builds a session for one
user from a row just read out of the database. It grants that user's identity and
nothing more, so every downstream check — `assertProjectAccess`, membership
lookups, the note lock — applies exactly as if they had asked themselves.

## Track C — Memory

| Item | Where |
|---|---|
| C-1 rolling summary | `src/server/llm/conversations.ts` |
| C-2 durable facts + tools | `src/server/llm/memory.ts` |
| C-3 titles, history, delete | `src/server/llm/conversations.ts`, `agent` router |
| Settings UI | `src/components/settings/AiSettingsClient.tsx` |

Nothing is remembered by inference — only through an explicit `rememberFact` call
the user's own words triggered. Every row is listed verbatim and deletable.

`rememberFact`/`forgetFact` are the only tools A1 holds that write anything, and
what they write is the caller's own preference row, not workspace data. A1 still
cannot change anything a teammate would see.

## Track D — Ambient

| Item | Where |
|---|---|
| D-2 command palette (⌘K) | `src/components/layout/CommandPalette.tsx` |
| Mounted globally | `src/components/layout/GlobalAIWidget.tsx` |
| Prefill plumbing | `AIChatPageClient.tsx`, `ProjectIntelligenceChat.tsx` |

Navigation matches locally and never calls the model; the "ask the assistant" row
is always something you select, never something that fires because nothing
matched.

## Track E — Composition

| Item | Where |
|---|---|
| E-1 `clarify` intent | `src/server/llm/schemas/a1WorkspaceConciergeSchemas.ts` |
| E-2 multi-agent turns | `src/server/llm/orchestrator/handoff.ts` |
| E-3 refinement turns | `src/server/llm/orchestrator/a2TaskPlanner.ts` |
| E-4 A5 Org Admin | `src/server/llm/orchestrator/a5OrgAdmin.ts` + schemas/prompts/context |

A turn may now run up to three sub-agents, deduplicated by target agent. The
schema accepts both `handoff` and `handoffs` and normalizes to a list, so a model
emitting either shape still routes.

**A5 authorizes per operation, not per plan.** An org plan can span several
organizations and each operation depends on a different capability flag; checking
once would let the weakest operation ride in on the strongest one's permission.
Refusals are collected rather than aborting the apply, and role changes re-read
the caller's *live* membership so an admin demoted between draft and apply cannot
still run the plan.

## Track F — Proof

| Item | Where |
|---|---|
| F-1 eval harness, 53 cases | `tests/agents/evals/` |
| F-2 authorization regressions | `tests/agents/toolAuthorization.test.ts` |
| F-3 observability | `src/server/llm/observability.ts`, `agent.metrics` |
| F-4 model tiering | `src/server/llm/core/modelClient.ts` (`tier: "fast"`) |

The eval suite has a coverage guard that fails when a new tool accepts a
caller-supplied id without a matching authorization test — it caught two on its
first run.

## Track G — Polish

| Item | Where |
|---|---|
| G-1 streaming answer text | `src/server/llm/core/summaryStream.ts` |
| G-2 five agent languages | `src/server/llm/prompts/a1Prompts.ts` |
| G-3 clickable citations | `citationHref` in `src/hooks/useAgentStream.ts` |
| G-4 follow-ups | A1 schema + prompt |
| G-5 undo | `src/server/llm/undo.ts` |

**How the answer streams from a JSON contract.** A1 returns one object, so half
of it is not renderable. Instead the server scans the model's JSON as it arrives
and decodes `answer.summary` out of it, emitting `answer_delta` frames. The
complete object is still parsed and validated at the end — this is a view onto
the same bytes, and a client may ignore the deltas entirely.

**What undo can and cannot do.** Creates are reversible because the apply row
records the inserted ids. Updates and deletes are not: the applies table records
*which* rows were touched, never their prior contents. Undo says so rather than
claiming a rollback it cannot perform. Recording before-images would fix that and
is a schema change, not a code change.

---

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors
- `pnpm test` — 1631 passing, 189 of them new
- `pnpm build` — succeeds

One pre-existing failure remains in `tests/components/SettingsPage.test.tsx`,
caused by commit `3c16a69` (the TopBar refactor) and untouched by this work. It
asserts on source text rather than behaviour, which the codebase audit already
flagged as a pattern (#13).

## Known gaps

- **Timezones.** `ai_schedules.hourUtc` is UTC. Fine for one region; a real
  timezone column is needed before this ships more widely.
- **Undo of updates/deletes** needs before-images in the applies tables.
- **Live evals.** The harness measures our half of the contract offline. Wiring
  `EVAL_LIVE=1` to send the real messages upstream is the obvious next step.
- **`getAiMetrics` is per-user.** A cross-tenant admin view needs an admin role,
  which KAIROS does not currently have.
