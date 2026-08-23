# Pro Features — Phased Implementation Plan

> Companion to [`docs/business/pricing-strategy.html`](business/pricing-strategy.html). That memo
> argues *what* Pro should contain. This one sequences *how*, cheapest first.
>
> Ordering principle: **effort ascending, not value descending.** Every phase is
> independently shippable and independently sellable, so if the roadmap stalls at
> the end of any phase, what exists is still a coherent paid tier.
>
> Estimates are one engineer, calendar days, including tests and UI. They assume
> familiarity with this codebase.

---

## Effort at a glance

| # | Feature | Phase | Est. | New table? | New dep? |
|---|---|---|---|---|---|
| 0 | Entitlement flags | 0 | ~~0.5d~~ **done** | no | no |
| 1 | Real timezones for schedules | 1 | ~~1d~~ **done** | no — column existed | no |
| 2 | Weekly retrospective | 1 | ~~1.5d~~ **done** | 1 column | no |
| 3 | Standing instructions | 1 | ~~1d~~ **done** | no | no |
| 4 | Export (MD / CSV / ICS) | 1 | ~~2d~~ **done** | no | no |
| 5 | History retention split | 1 | ~~1.5d~~ **done** | 1 index | no |
| 6 | Deadline watch | 2 | ~~2d~~ **done** | no | no |
| 7 | Brief to email | 2 | ~~2.5d~~ **done** | 2 columns | no |
| 8 | User-defined schedules | 2 | ~~3d~~ **done** | yes | no |
| 9 | Per-plan rate ceilings | 2 | ~~1d~~ **done** | no | no |
| 10 | Plan diff preview | 3 | ~~4d~~ **server done** | 1 column ×4 | no |
| 11 | API keys + webhooks | 3 | ~~5d~~ **server done** | yes (3) | no |
| 12 | Documents the agents read | 3 | 8d | yes (2) | pgvector |
| 13 | Meeting prep briefs | 3 | 3d | no | no (needs #14) |
| 14 | Two-way calendar sync | 4 | 12d | yes (2) | Google/MS SDK |
| 15 | Reply by email to act | 4 | 6d | yes | inbound provider |
| 16 | Custom tools (MCP/HTTP) | 4 | 10d | yes | no |
| 17 | Priority model tier | 4 | 2d | no | no |

Phase 1 totals about **7 days** and covers five of the roadmap rows. Phase 4 alone
is longer than phases 0–3 combined, which is the whole argument for the ordering.

---

## Phase 0 — The seam (0.5 day)

**Do this first and merge it alone.** It is the only change that touches many files,
and it is safest when it changes no behaviour.

[`src/server/billing/entitlements.ts`](../src/server/billing/entitlements.ts) currently
declares two flags. Extend `Entitlements` with one field per boundary in the pricing
table, keep `entitlementsFor` returning the constant, and keep every flag `true`:

```ts
export interface Entitlements {
  plan: PlanId;
  // shipped, currently ungated
  scheduledAgents: boolean;
  agentPinning: boolean;
  undoApply: boolean;
  toolInspector: boolean;
  customTools: boolean;
  perAgentMemory: boolean;
  aiRequestsPerDay: number;      // 15 free / 200 pro
  // roadmap — nothing reads these yet
  historyDays: number | null;    // null = unlimited
  maxSchedules: number;
  standingInstructions: boolean;
  documents: boolean;
  emailDelivery: boolean;
  calendarSync: boolean;
  apiAccess: boolean;
  planDiff: boolean;
  exportData: boolean;
}
```

A flag added before its feature costs one line and keeps the paywall argument out of
the feature PR. Add `FREE_ENTITLEMENTS` next to `PRO_ENTITLEMENTS` now too — unused,
but it makes the eventual diff in `entitlementsFor` a two-line change.

Client side, [`billing.entitlements`](../src/server/api/routers/billing.ts) is already
exposed. Add a `useEntitlement("documents")` hook so components branch on a flag
rather than on `isPro`, and gate every new Phase 1+ feature through it as it lands.

**Done when:** the flags exist, the router returns them, and typecheck passes with no
behavioural diff.

---

## Phase 1 — Cheap, shipped in a week (~7 days) — ✅ complete

> **Shipped.** Notes on what diverged from the sketches below are recorded under
> each item. Three things are worth carrying into Phase 2:
>
> - **The `server-only` boundary bites once per feature.** `entitlements`,
>   `timezone` and now `memoryScopes` all had to be split into a pure
>   `~/lib/*` module because a client component needed a constant from a
>   `server-only` file. `tsc` does not catch it — it surfaces at build time.
>   Assume any new shared constant needs this split from the start.
> - **The Drizzle journal trap fired on both migrations.** Generated `when`
>   values were *lower* than the previous entry each time, which silently skips
>   the migration. Check `meta/_journal.json` after every `db:generate`.
> - **Both migrations are generated but NOT applied.** `pnpm db:migrate` still
>   needs to run against the remote Supabase dev database.

Everything here reuses machinery that already exists. No new tables, no new
dependencies, no new external accounts.

### 1. Real timezones for schedules — ✅ done *(was: 1 day, launch blocker)*

The memo names this as gating Pro, and it is the smallest item on the page.

**What the estimate got wrong.** It assumed a migration. `users.timezone`
(`varchar(100) not null default 'UTC'`) already existed, was already in the
baseline migration, was already written by `settings.updateLanguageRegion`, and
already had a picker in `LanguageSettingsClient`. The scheduler simply never read
it. So the work was a scheduler change and a rename, with no schema change at all.

**What shipped**, differing from the sketch below where noted:

- `~/lib/timezone` — `localHourIn`, `localDayKeyIn`, `isValidTimeZone`,
  `supportedTimeZones`, `guessTimeZone`. Pure, cached formatters, UTC fallback.
- `scheduled/due.ts` — `isScheduleDue`, the whole due-ness rule, split out so it
  is testable without the database client (importing `runner.ts` loads validated
  server env).
- `dueSchedules()` joins `users.timezone` and filters in JS, as planned.
- **Day comparison uses calendar-day keys, not a computed local midnight.** The
  sketch below said to move the `startOfDay` boundary into the user's zone; that
  is an hour wrong on the two DST days a year. Comparing `YYYY-MM-DD` in the zone
  is exact.
- **The claim step became a compare-and-swap** on `lastRunAt`. It could not stay
  a re-test of the due-ness predicate, because due-ness is no longer expressible
  in SQL. Matching the exact value the sweep read is strictly stronger.
- **The picker went from 6 hardcoded zones to the full IANA set.** A short list
  was fine while this was cosmetic; it is not fine when it decides when someone's
  morning is.
- **`updateLanguageRegion` now validates the zone.** It accepted `z.string()`,
  and an unknown zone would throw inside the sweep for every user after it. Bare
  offsets (`+02:00`) are rejected too — `Intl` accepts them, and they reinstate
  exactly the seasonal drift being removed.
- Settings shows the zone once under the hour pickers (`timeZoneHint`, added to
  all five locales); the option labels no longer read "UTC".
- Stored `UTC` is indistinguishable from a deliberate choice, so the form now
  offers the browser's guess and marks itself dirty rather than saving unprompted.

27 tests across `tests/lib/timezone.test.ts` and `tests/agents/scheduleDue.test.ts`,
weighted toward DST transitions in Europe/Sofia.

<details>
<summary>Original sketch, kept for the reasoning</summary>


`aiSchedules.hourUtc` in [`schemas/agents.ts`](../src/server/db/schemas/agents.ts)
stores an hour with no zone, and `dueSchedules()` in
[`scheduled/runner.ts`](../src/server/llm/scheduled/runner.ts) compares it directly
against `now.getUTCHours()`. A brief set for 07:00 arrives at 09:00 in Bulgaria and
drifts an hour twice a year.

- Add `timezone varchar(64) not null default 'UTC'` to `users` — not to `ai_schedules`.
  A user has one morning, not one per schedule kind.
- Rename the concept, not just the column: `hourUtc` → `hourLocal`. Keep the physical
  column name via `integer("hour_utc")` for one release so the migration is additive,
  then rename in a follow-up.
- In `dueSchedules()`, stop filtering by hour in SQL. Select enabled-and-not-run-today
  rows, join the user's timezone, and filter in JS with
  `Intl.DateTimeFormat("en", { timeZone: tz, hour: "numeric", hour12: false })`.
  The row count is capped at 500 and the sweep is hourly, so per-row formatting is
  free — and this avoids dragging `pg_timezone_names` into the query.
- The daily-run guard (`lastRunAt <= startOfDay`) must also move to the user's day
  boundary, or a UTC+13 user gets two briefs on one of their days.
- UI: a timezone select in AI settings, defaulted from
  `Intl.DateTimeFormat().resolvedOptions().timeZone` on first save.

**Risk:** the `ai_schedule_due_idx` on `(enabled, hourUtc)` stops being useful. At 500
rows that does not matter; revisit if the userbase makes it matter.

</details>

### 2. Weekly retrospective — 1.5 days

The cheapest genuinely new Pro feature, because the schema already anticipated it:
`ai_schedules.kind` is a varchar, and its own comment says so — *"Kept as text so
adding a kind is not a migration."*

- New module `src/server/llm/scheduled/weeklyRetro.ts`, modelled on
  [`dailyBrief.ts`](../src/server/llm/scheduled/dailyBrief.ts). Same shape:
  `collectRetroFacts` → `retroIsEmpty` → `writeRetro` / `fallbackRetro`.
- Facts over a 7-day window: tasks closed, tasks created, tasks that changed status,
  tasks untouched for 14+ days, events held, findings raised and dismissed. All plain
  SQL against `tasks` / `events` / `ai_findings` — no new reads to build.
- `runner.ts` dispatches kinds on a two-branch ternary. Replace it with a
  `Record<ScheduleKind, (userId: string) => Promise<number>>` **before** adding the
  third kind, or every future kind pays the same tax.
- Weekly cadence needs one guard the daily one does not: add `dayOfWeek` (`integer`,
  nullable, null = daily) and skip rows whose day is not today in the user's zone. Do
  this after #1 so only one place knows what "today" means.

**Why it is worth 1.5 days:** it reuses the brief's prompt structure, the notification
path, the opt-in row, the rate-limit consumption and the stay-quiet-when-empty rule.
Roughly 80% of the feature is already written.

### 3. Standing instructions — 1 day

Also migration-free. `aiUserMemory.scope` is a varchar defaulting to `"global"`, with a
unique index on `(userId, scope, key)`. Standing instructions are a third scope value.

- Add `export const INSTRUCTION_SCOPE = "instruction"` beside `GLOBAL_SCOPE` in
  [`memory.ts`](../src/server/llm/memory.ts).
- Cap it separately (10 feels right) and load it into the prompt in its own block,
  labelled as directives rather than facts. The distinction matters: memory records
  *what the agent learned*; an instruction records *what the user decreed*, and the
  model should resolve a conflict in the user's favour.
- Critically: instructions must **not** be writable by `rememberFact`. Memory's stated
  rule is that nothing is written by inference, and an instruction the model can write
  for itself is a self-modifying system prompt. Settings UI only.

**Scope note:** the pricing table says "per workspace". Per-user is the honest Phase 1
version; per-project needs a `projectId` column and is a Phase 2 follow-up. Ship the
user-level one and label it accurately.

### 4. Export (MD / CSV / ICS) — 2 days

`settings.requestDataExport` in
[`routers/settings.ts`](../src/server/api/routers/settings.ts) is a stub that returns
*"You'll receive an email when it's ready"* and does nothing. That is worse than not
having the button, and it is the one item here that fixes a live defect rather than
adding a feature.

- Build it synchronously, not as a job queue. One user's tasks, notes, events and
  conversations are small; stream the response and skip the whole we-will-email-you
  apparatus.
- Three formats, three pure functions in `src/server/export/`: `toMarkdown` (notes +
  conversations), `toCsv` (tasks, one row each), `toIcs` (events + tasks with due
  dates — hand-rolled; ICS is simple text and a dependency is not worth it).
- Serve from a route handler at `src/app/api/export/[format]/route.ts` with a
  `Content-Disposition` attachment header, session-checked. Not from tRPC — tRPC is
  the wrong transport for a file download.
- Gate on `entitlements.exportData`, but let Free export **tasks as CSV**. A fully
  paywalled export path reads as hostage-taking; a partial one reads as a feature.

### 5. History retention split — 1.5 days

Note the inversion: history is *already* unlimited. `ai_conversations` and `ai_messages`
have no retention job at all, so "unlimited history for Pro" needs no build. What needs
building is the **30-day cull for Free**, plus the search that makes unlimited worth
paying for.

- Retention: a nightly sweep deleting `ai_messages` older than `historyDays` for
  free-plan users. Piggyback on the existing internal endpoint at
  [`api/internal/ai/run-schedules`](../src/app/api/internal/ai/run-schedules/route.ts)
  rather than adding a second cron.
- **Guard the summary.** [`conversations.ts`](../src/server/llm/conversations.ts) folds
  aged-out turns into `summary` and tracks `summarizedThroughId`. Deleting messages
  underneath that pointer is fine — the summary survives, which is correct — but the
  cull must never remove a conversation row whose summary is the only remaining record.
  Delete messages, keep conversations.
- Search: a `search` procedure over `ai_messages.content` using `to_tsvector` /
  `plainto_tsquery` with a GIN index. Ten lines of SQL, and it is what makes the
  retention difference visible on day one instead of day thirty-one.

---

## Phase 2 — Makes proactivity real (~8.5 days) — ✅ complete

> **Shipped.** Two findings from this phase are worth carrying forward:
>
> - **A1 is not as read-only as its own comment claimed.** `draftToolAllowlist`
>   includes `rememberFact` and `forgetFact`, which write to and delete from the
>   caller's preference rows. Fine interactively; wrong on a timer, since
>   `memory.ts`'s first rule is that nothing is written by inference.
>   `customSchedules.ts` subtracts them, and the profile comment is corrected.
> - **`runToolLoop` gates on `registry`, not on `tools`.** Filtering the
>   definitions only changes what the model is *told about*; a name it produces
>   anyway is looked up in the registry and runs. Both must be narrowed.
>   Any future feature binding a reduced tool set needs the same pair.
>
> The Drizzle journal trap fired on both of this phase's migrations too — four
> for four across Phases 1 and 2.

Phase 1 makes Pro *bigger*. Phase 2 fixes the weakness the memo admits: a proactive
assistant whose output waits in a tab for you to come and find it.

### 6. Deadline watch — 2 days

A new detector inside [`riskRadar.ts`](../src/server/llm/scheduled/riskRadar.ts), not a
new subsystem. `ai_findings` already provides fingerprint dedupe, severity, dismissal,
and the "only notify on genuinely new, non-info findings" rule in `runner.ts`.

- Detector: for each task with a `dueDate` inside 7 days, grade by *state*, not date
  alone — `todo` with 2 days left is `warn`; `todo` with 0 days is `crit`;
  `in_progress` with 1 day is `info`. The memo's point is that the escalation reads the
  task, not the calendar.
- The fingerprint must encode the bucket (`deadline:{taskId}:{bucket}`) so crossing
  warn → crit raises a *new* finding rather than deduping against the old one. Get this
  wrong and the feature silently never escalates — and it will look like it works.
- Costs zero inference: detection is pure SQL, and the brief already wraps findings in
  prose when budget allows.

### 7. Brief to email — 2.5 days

`resend` is already a dependency and [`email.ts`](../src/server/email/email.ts) already
has the `emailWrapper()` scaffolding plus four working templates.

- One new template, `briefEmail({ userName, brief, findings, appUrl })`, reusing the
  wrapper so it matches existing transactional mail.
- Delivery preference on `ai_schedules`: `channel varchar(16) not null default 'app'`,
  values `app` | `email` | `both`.
- Failure handling matters more here than in-app. A bounced brief must write `lastError`
  and **not** report success; three consecutive failures should disable the channel and
  notify in-app, or a dead address generates a bounce every morning forever.
- Slack is deliberately **not** in this item. Slack needs an OAuth app, a workspace
  install flow and a token store — Phase 4 work wearing a Phase 2 label. Ship email,
  and say email.

### 8. User-defined schedules — 3 days

Generalising two hardcoded kinds into an open surface.

- New table `ai_custom_schedules`: `userId`, `name`, `prompt` (text, ~500 char cap),
  `dayOfWeek` (nullable), `hourLocal`, `channel`, `enabled`, `lastRunAt`, `lastError`.
  Separate from `ai_schedules` rather than a nullable prompt on it — the built-ins have
  a fixed fact-collection path and custom ones do not, and merging them means every
  read branches.
- Execution runs the prompt through the **A1 read-only tool set**
  ([`readTools.ts`](../src/server/llm/tools/a1/readTools.ts),
  [`searchTools.ts`](../src/server/llm/tools/a1/searchTools.ts)) with no write tools
  bound. A schedule firing unattended must not be able to create anything; A1's
  read-only invariant is exactly the needed property and it already holds.
- Enforce `entitlements.maxSchedules` (3 on Pro) at insert, not at run — a user who
  downgrades keeps their rows, and the runner skips past the cap.
- Each run consumes `consumeSystemRateLimit` like the built-ins, so three custom
  schedules cannot outspend the proactive budget.

### 9. Per-plan rate ceilings — 1 day

[`rateLimit.ts`](../src/server/security/rateLimit.ts) reads `AI_RATE_LIMIT` into a
module constant. Correct for one global limit; wrong the moment two plans differ.

- Thread a `limit` parameter through `checkRateLimit` / `consumeRateLimit`, defaulting
  to the env value. Call sites pass `entitlements.aiRequestsPerDay`.
- The sliding-window store needs no change — the key is already per-user and the ceiling
  is only read at comparison time.
- Watch the downgrade case: a user dropping 200 → 15 with 40 hits in the window is over
  the new ceiling. `remaining` must clamp at 0, and the UI must never render
  "-25 requests left".

---

## Phase 3 — Real engineering (~15 days)

> **#10 is done server-side.** `beforeJson` is on all four `*_applies` tables,
> captured by A2 and A3, and it upgraded undo from "delete what was created" to a
> real rollback of edits — the thing `undo.ts` documented as impossible.
>
> Two corrections to the sketch below:
>
> - **"Same transaction" was not available.** The apply path is a sequence of
>   statements, not a transaction. The image is captured by reading the affected
>   rows immediately before mutating them. A crash mid-apply can leave an image of
>   partly-changed rows — still strictly more than the nothing recorded before, and
>   making the apply transactional is its own change.
> - **Deletes are still not reversible, and that is deliberate.** The image holds a
>   deleted row's *contents* but its id is gone; re-inserting under a new one would
>   silently orphan every task comment, activity-log entry and finding that pointed
>   at the old one. Reported honestly rather than faked.
>
> **No client UI.** There is no undo UI either — `undoApply` and `undoAvailability`
> have existed with no caller — so `taskPlanDiff` matches the existing state rather
> than falling short of it. The diff card belongs in the chat components another
> session is currently rewriting.

Each of these is a genuine build. None is required to justify €12, and none should be
promised with a date before its phase starts.

### 10. Plan diff preview — 4 days

Blocked today by the same gap that limits undo. [`undo.ts`](../src/server/llm/undo.ts)
is explicit: the applies tables record *which* rows were touched, never their prior
contents, so updates and deletes can be neither reversed nor diffed.

- Add `beforeJson text` to the four `*_applies` tables, written inside the same
  transaction as the apply. This is the enabling change, and it upgrades undo from
  "removes what was created" to a real rollback at the same time — two features, one
  migration.
- The preview then reads the draft's `planJson`, fetches current state for every
  referenced id, and renders a field-level diff before confirmation.
- Size-cap the before-image (a plan touching 200 tasks stores a truncation marker, not
  200 full rows) or the applies tables become the largest in the database.

### 11. API keys and webhooks — ✅ server done *(was: 5 days)*

> Three departures from the sketch below, all corrections:
>
> - **SHA-256, not argon2.** The plan said argon2 because that is how passwords are
>   stored two tables over. Wrong here: a key is 32 bytes of `randomBytes`, so there
>   is nothing to guess, and a slow KDF buys only ~100ms of CPU on every API
>   request — which an attacker triggers for free by sending garbage. Fast hash,
>   high entropy, prefix lookup, constant-time compare.
> - **Three tables, not two.** `webhook_deliveries` is separate, because the plan's
>   own note that the delivery log "is not optional" needs somewhere to live.
> - **An SSRF guard the sketch did not mention.** A user-chosen URL is a request
>   *this server* makes. `isAllowedWebhookUrl` refuses plaintext HTTP, loopback,
>   RFC1918, link-local, cloud metadata endpoints and IPv6 unique/link-local, and
>   delivery uses `redirect: "manual"` so a 302 cannot walk around the check. DNS is
>   not resolved, so a hostname resolving to a private address is still reachable —
>   noted rather than half-done.
>
> **No client UI**, consistent with the rest of Phase 3.

<details>
<summary>Original sketch</summary>

- `api_keys`: hashed key (`argon2` is already a dependency), label, `lastUsedAt`, scopes,
  revocation. Show the plaintext exactly once.
- Authenticate via a header check in [`trpc.ts`](../src/server/api/trpc.ts) that builds
  the same session shape a cookie would, so procedures need no changes.
- Rate limit per key through the existing sliding window with an `api:{keyId}` key —
  drawn from the same daily budget, not a second one, or the ceiling is decorative.
- `webhooks`: URL, secret, event filter, delivery log. HMAC-SHA256 signatures, retry
  with backoff, auto-disable after repeated failure. The delivery log is not optional —
  an undeliverable webhook with no visible history is unsupportable.

</details>

### 12. Documents the agents can read — 8 days

The largest item before Phase 4, and cheaper here than in most codebases: `uploadthing`
is wired ([`api/uploadthing/core.ts`](../src/app/api/uploadthing/core.ts)) and PDF text
extraction already exists at
[`pdfExtractor.ts`](../src/server/llm/pdf/pdfExtractor.ts) for task extraction.

- `documents` (metadata, owner, project, upload key) and `document_chunks` (text,
  embedding, ordinal).
- Retrieval: pgvector on Supabase is available and is the right answer. The fallback,
  if enabling the extension is a problem, is Postgres full-text over chunks — worse
  recall, zero new infrastructure, a third of the time. **Decide this before starting,
  not halfway.**
- One new A1 read tool, `searchDocuments`, returning chunks with citations. It joins the
  existing 21-tool surface rather than forming a parallel path.
- Embeddings cost inference on **upload** — a spend shape nothing else in the product
  has. A user uploading a 300-page PDF is a bill, and the daily request window will not
  catch it. Meter pages, not requests, on this one path.

### 13. Meeting prep briefs — 3 days *(depends on #14 in practice)*

Mechanically a variant of the daily brief fired 30 minutes before an event rather than
at a fixed hour. Against KAIROS-native `events` it is genuinely a 3-day feature.

It sits behind calendar sync because it is only compelling against a *real* calendar.
Users whose meetings live in Google Workspace will not create them twice, and a
meeting-prep feature that only knows about meetings you typed into KAIROS describes a
product nobody has.

Ship it in Phase 3 for native events if the schedule allows; expect the actual value to
arrive with #14.

---

## Phase 4 — Longest tail (~30 days)

Not roadmap items so much as separate projects. Each needs an external account, an OAuth
flow, or a security model of its own.

- **14. Two-way calendar sync (12d)** — Google + Microsoft OAuth, refresh-token storage
  (encryption exists at [`encryption.ts`](../src/server/security/encryption.ts)),
  incremental sync tokens, conflict resolution. Two-way is where the cost is; read-only
  import is roughly a third of the estimate and unlocks #13 on its own.
  **Consider shipping read-only first and calling it that.**
- **15. Reply by email to act (6d)** — needs an inbound provider (Resend does not do
  inbound; Postmark or SES). The hard part is not parsing, it is authorisation: an email
  address is a spoofable identifier, so replies need a per-message signed token and must
  land in the existing confirm step rather than applying directly.
- **16. Custom tools (10d)** — the `customTools` flag has existed since
  `entitlements.ts` was written. Registering a user-supplied HTTP endpoint or MCP server
  into the tool loop is an SSRF and prompt-injection surface pointed straight at
  [`toolLoop.ts`](../src/server/llm/core/toolLoop.ts). It needs egress allow-listing,
  timeouts, response size caps and per-tool rate limits before it can be enabled for
  anyone.
- **17. Priority model tier (2d)** — small, but pointless until inference is paid.
  [`modelClient.ts`](../src/server/llm/core/modelClient.ts) already supports
  `tier: "fast"`; priority means routing Pro turns to the better tier and Free to the
  cheap one, which requires the tiers to actually differ in cost. Do the cheap-tier
  routing the pricing memo already calls for first — that is a margin fix, not a feature.

---

## Cross-cutting notes

**Migrations.** Generated Drizzle migrations in this repo are silently skipped unless the
`when` value in the journal is raised by hand — check every generated migration before
applying. The dev database is a **remote Supabase instance**, not a local one; confirm
before anything destructive. `drizzle.config.ts` uses `DATABASE_DIRECT_URL` because the
pooler cannot do DDL introspection.

**Hard sequencing constraints** — the only ones:

```
#0  flags        ──> everything
#1  timezone     ──> #2 weekly retro ──> #8 custom schedules
#10 before-image ──> real undo (and the diff)
#14 calendar     ──> #13 meeting prep (in practice, not in code)
```

**What to announce.** The memo's own assumption panel warns against a Pro tier that is
mostly footnotes. Concretely: announce Phase 1 at launch, announce Phase 2 when it
merges, and never put Phase 3 or 4 on a pricing page with a date.

**Suggested cut line.** If Pro must launch in two weeks: Phase 0 + Phase 1 + item #7
(brief to email). Roughly 9.5 days of work, it clears the timezone blocker, and it
produces a tier whose headline feature actually arrives somewhere the user already is.
