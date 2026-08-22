# KAIROS Companion — Chrome MV3 extension

## Context

KAIROS is a team-coordination web app (projects, tasks, notes, events, chat) with a five-agent
AI assistant over it. Today the assistant is only reachable from inside the app: you have to be
on a KAIROS tab to plan anything. The idea is a small Chrome extension, distributed from GitHub
Releases, that puts the same agents one keystroke away from any page — highlight text, right-click,
and the Task Planner turns it into real tasks in your real workspace.

Three decisions shape everything below:

1. **The extension is a thin client, not a second product.** It requires a KAIROS account and
   everything it creates is synced to the real workspace. `chrome.storage` holds settings, the
   pairing token, and an offline *read* cache — there is no local-only task concept.
2. **Users bring their own LLM key.** Each user pastes a provider key once in KAIROS web settings;
   it is encrypted at rest and used for their web turns, extension turns, and scheduled agents
   alike. This is what makes a public, free, GitHub-distributed extension viable at all — without
   it, every stranger's tokens come out of the project's own NVIDIA NIM key, and their task text
   plus name and email flow to a free tier whose ToS §4.3 forbids personal data and §3.3(iv)
   permits training on it (already documented in `docs/llm-provider-research-2026-08-21.md`).
   BYOK moves that agreement to the user, where it belongs.
3. **Deploy target is Vercel Hobby**, whose 60s function cap is *below* the current 90s tool-loop
   budget. This is a design constraint, not an edge case.

Roughly 40% of the work is server-side and must land first. Nothing on the server accepts a bearer
token today, and no per-user provider key exists.

**Out of scope, flagged not solved:** `ws-server/` (socket.io) cannot run on Vercel, so realtime
chat/notifications and the scheduler that drives Daily Brief / Risk Radar have no home there.
Vercel Cron on Hobby is one invocation/day at 60s, which cannot fit `dueSchedules`' `.limit(500)`
at `CONCURRENCY = 4`. The BYOK work below still threads credentials through `scheduled/runner.ts`,
so proactive agents work wherever a `ws-server` is running — but choosing that host is a separate
decision.

---

## Part 1 — Server: per-user encrypted provider credentials

### 1.1 Crypto module — `src/server/llm/core/llmCredentialCrypto.ts` (new)

AES-256-GCM via `node:crypto`, `import "server-only"`.

`src/server/security/encryption.ts` **cannot be reused**: it derives its key from the note's
password via PBKDF2, so it cannot decrypt without user input — fatal for scheduled agents. Do
follow its conventions, which are the house style: explicit version marker, a docblock that
explains *why* the format is versioned, IV+tag+ciphertext discipline.

- IV = 12 random bytes (GCM's native nonce), fresh per encryption.
- **AAD = `${userId}:${keyVersion}`.** Load-bearing, not decoration: without it anyone with DB
  write access can copy a victim's ciphertext row onto their own `user_id` and bill turns to the
  victim's provider account. With the user id in the tag, that row fails authentication.
- Three explicit columns (`key_ciphertext`, `key_iv`, `key_auth_tag`) rather than one packed
  string — matches the column style in `src/server/db/schemas/users.ts`, and lets a rotation sweep
  use `WHERE key_version = 1` as an ordinary query.
- Mask is **stored, not derived** (`key_prefix`, `key_last4`), so drawing a read-only settings
  field never decrypts anything. `key_prefix` is null when the plaintext is under 20 chars.
- There is never a `getApiKeyPlaintext` procedure. The only reader is §1.4's resolution path.

New env vars in `src/env.js` (all `.optional()`, matching the `LLM_*` precedent so the app still
boots with BYOK off): `CREDENTIAL_ENCRYPTION_KEY` (32 raw bytes, base64),
`CREDENTIAL_ENCRYPTION_KEY_V2` (rotation slot).

**Do not reuse `AUTH_SECRET`.** Rotating `AUTH_SECRET` just signs everyone out — cheap, something
you want to do on a whim. Rotating the credential key requires re-encrypting every row; sharing
one secret means the cheap rotation inherits the expensive one's cost and neither ever happens.
`AUTH_SECRET` is also already an HMAC key in three places (`orchestrator/shared.ts`,
the account-switch cookie, JWT signing), it is validated as 32 *characters* not 32 *bytes* (so
reuse needs an HKDF step), and its compromise forges KAIROS sessions whereas this key's compromise
hands out every user's third-party provider credentials — someone else's money.

### 1.2 SSRF — the risk nobody asked about

A user-supplied `baseUrl` means the server makes outbound HTTPS to a host the user chose, from
inside Vercel's network. New `assertSafeProviderUrl(url)`, applied at **write** time and again at
**resolution** time (DNS can be re-pointed between them):

- `https:` only in production; `http:` allowed when `NODE_ENV !== "production"` for local Ollama.
- Reject embedded credentials, IP-literal hosts, and hostnames resolving into loopback / RFC1918 /
  link-local / CGNAT / IPv6 ULA.
- **Default to a host allowlist** with an `LLM_BASE_URL_ALLOWLIST` env escape hatch for
  self-hosters. Seed from the providers the repo already documents. An allowlist is the only
  airtight mitigation, and BYOK users are pasting keys for well-known providers anyway. Residual
  TOCTOU stated honestly: full mitigation needs a pinned-IP `fetch`, which `modelClient` doesn't do.

### 1.3 Schema — `src/server/db/schemas/credentials.ts` (new)

Three tables in one file, header: *"Secrets the user owns. Nothing here is ever returned to a
client in plaintext."* Column and comment style copied from `schemas/agents.ts`.

| Table | Purpose | Notes |
|---|---|---|
| `user_llm_credentials` | One row per user (unique index on `user_id`) | `base_url` / `model` / `fallback_model` / `fast_model` plaintext — a URL and a model id are not secrets and must be editable. Key encrypted. `last_verified_at`, `last_verify_error`. |
| `extension_tokens` | Bearer tokens | `token_hash` = SHA-256 hex, never the token. 32 bytes of CSPRNG has nothing to brute-force, so argon2 buys nothing and costs ~100ms per request — and couldn't be indexed. `label`, `last_used_at`, `expires_at`, `revoked_at`. |
| `extension_pairings` | In-flight device flow | `device_code_hash`, `user_code`, `user_id` (null until approval), `token_id` (non-null == spent). Declare **after** `extension_tokens` for the FK direction. |

**⚠ The migration trap.** `pnpm db:generate` stamps `when: Date.now()` ≈ `1787356800000`, but
journal entry `0029` already carries `1787961602000` (≈ 2026-08-29). Drizzle applies a file only
when `Number(lastDbMigration.created_at) < migration.folderMillis`
(`node_modules/drizzle-orm/pg-core/dialect.js:62`), so **the new migration is skipped silently
with exit code 0** — no error, no warning, code and schema then disagree at runtime. Hand-edit
`src/server/db/migrations/meta/_journal.json` to `when: 1787961603000`, then verify:

```bash
psql "$DATABASE_DIRECT_URL" -c 'select hash, created_at from __drizzle_migrations order by created_at desc limit 3;'
```

Never `pnpm db:push` against the deployed DB — it diffs live schema against code and drops what
the journal never knew about. `meta/0008_snapshot.json` is already missing; `generate` reads the
highest snapshot so it doesn't block. Do not "fix" it by renumbering. Rollback is clean: the
migration is purely additive.

### 1.4 Threading credentials into `modelClient` — AsyncLocalStorage

Credentials are read by four module-private helpers in
`src/server/llm/core/modelClient.ts` (`getBaseUrl` :99, `getApiKey` :103, `getModelChain` :108,
`getFastModelChain` :122) plus `assertConfigured` :542. Two ways to make them per-user:

| | Edit sites | Files touched |
|---|---|---|
| Explicit `ChatRequest` param | **≈60** | 16 — every orchestrator, `jsonRepair`, `conversations`, all four sub-agents, `taskGeneration`, both schedulers |
| **AsyncLocalStorage (chosen)** | **≈12** | 4 — `modelClient` plus three entry points |

Three objections to ALS, all retired:

- **Does it survive `after()`?** Yes, verified from the installed dependency:
  `node_modules/next/dist/server/after/after-context.js` wraps callbacks in `bindSnapshot(...)`
  (comment: *"preserve all currently available ALS-es"*), and `bindSnapshot` is
  `AsyncLocalStorage.bind`. `after()` is called at `chat/route.ts:175` inside the `ReadableStream`
  constructor, which runs synchronously inside the request's `als.run(...)` frame. `ensureTitle`
  and `maybeSummarize` see the credentials with **no code**.
- **Async generators?** Sidestep rather than bet on resumption semantics. Resolve the store into a
  plain local at the top of each exported entry point and pass that local down —
  `const cfg = resolveLlmConfig()` in `chatCompletion` and `streamCompletion`, threaded into
  `singleCompletion`/`assertConfigured`/`resolveChain`. After the first frame nothing reads the
  store, so generator resumption cannot lose anything. Also removes repeated lookups from the hot path.
- **`scheduled/runner.ts`, outside any request?** ALS is *better* here, not merely acceptable:
  `mapLimit` runs `CONCURRENCY = 4` users concurrently, where a module-level "current key" would
  race. Wrap the existing `mapLimit` callback body in `withTurnContext` — one edit site, and it
  covers `dailyBrief.writeBrief` without touching `dailyBrief.ts`.

Honest cost: the dependency is invisible at the call site. Mitigated by `assertConfigured()`
throwing a specific message at the first model call, exactly three entry points enumerated in the
module header, and a test pinning "no store + no env throws".

**New files:**

- `src/server/llm/core/turnContext.ts` — the ALS store. Holds `{ llm: ResolvedLlmConfig,
  deadlineAt?: number }` together, because both are entered at the same three places, share a
  lifetime, and §3 needs the deadline visible at four layers. Exports `withTurnContext`,
  `currentTurn`, `msRemaining`, `resolveLlmConfig`. **Must never be reachable from `src/proxy.ts`
  or any Edge route** — `node:async_hooks` doesn't exist there.
- `src/server/llm/core/llmConfig.ts` — `envLlmConfig()` (reproduces today's chain logic
  byte-for-byte, including "fast falls back to strong" at `modelClient.ts:121-127`),
  `loadLlmConfigFor(userId)`, `hasUserLlmCredentials(userId)` (selects `id` only, no decrypt).

**Fallback rule, stated once:** user row → else `env.LLM_*` → else `source: "none"`. A user who
sets no key sees exactly today's behaviour; a deploy with only `LLM_API_KEY` is unchanged.

`assertConfigured` gets three new messages — the current ones name env vars, which is wrong advice
for someone who is supposed to paste a key in settings. Keep the `log.error` on the missing-env
branch; it's why a misconfigured deploy is diagnosable. The logger already redacts `apikey`,
`api_key`, `credential`, `secret`, `token`, `authorization` as case-insensitive substrings
(`src/server/logger.ts:61-74`), so no logging change is needed — just don't invent a field name
outside that list. `keySource` and `keyVersion` are safe to log.

**The three entry points:**

1. `src/app/api/ai/chat/route.ts` — wrap from `ensureConversation` through `return new Response(stream)`.
2. `src/server/api/routers/agent.ts` — one new `aiProcedure` middleware that `rateLimitedProcedure`
   composes onto. **All nine existing model-calling procedures are covered with zero further edits.**
   `previewBrief` (:556) moves from `protectedProcedure` to `aiProcedure`.
3. `src/server/llm/scheduled/runner.ts` — inside the `mapLimit` callback.

Not `createTRPCContext`: it cannot wrap `next()`, and it would pay a DB read + decrypt on every one
of the ~300 non-AI procedures.

### 1.5 Credentials router — `src/server/api/routers/credentials.ts` (new)

**Not** an extension of `settings.ts`, which is 232 lines of flat preference CRUD with no logging,
no rate limiting, and no outbound network calls. These procedures need encryption, a live provider
probe, masked-only reads, and per-action limits, and they sit next to the extension-token
procedures. Mount as `credentials` in `root.ts`; mirror `settings.ts`'s *shape* (flat
`protectedProcedure`, `{ success: true }` returns) so the UI consumes it identically.

- `getProvider` → `{ source: "user"|"env"|"none", baseUrl, model, maskedKey, lastVerifiedAt, ... }`.
  `source` lets the UI say "currently using the server's key" instead of showing an empty form.
- `setProvider` — `apiKey` optional so the model can change without re-pasting; absent *and* no
  existing row → `BAD_REQUEST`. `assertSafeProviderUrl` first, then `onConflictDoUpdate`.
- `testProvider` — accepts stored row or unsaved form values, so a key is validated before saving.
  **Probes tool calling, not just completion:** the agents need native function calling, and a key
  for an endpoint without it fails every A1 turn with an obscure error. Extract
  `probeBasic`/`probeTools`/`probeStreaming` from `scripts/llm-probe.ts:127-341` into
  `src/server/llm/core/providerProbe.ts` so the CLI and this procedure share one definition.
  Rate-limit `provider-test:${userId}` at 10/hour. **Scrub the plaintext key out of any stored
  error** — provider 401 bodies sometimes echo it.
- `deleteProvider` → `{ fellBackTo: "env"|"none" }` so the UI can warn "AI features are now off".
- Plus the extension-token and pairing procedures from §2.

UI extends the existing `src/components/settings/AiSettingsClient.tsx` at `/settings?section=ai` —
no new nav entry. i18n keys under `settings.ai.*`.

---

## Part 2 — Server: extension authentication

### 2.1 The blocker that stops everything

`src/proxy.ts` `isPublicPath()` (:69-86) allowlists `/api/auth`, `/api/trpc`, `/api/internal`,
`/api/account-switch`, `/api/uploadthing`. **`/api/ai/chat` is not on it.** A cookie-less request
is `307`'d to `/?callbackUrl=/api/ai/chat`, `fetch` follows it, and the caller gets 200 HTML —
exactly the failure `useAgentStream.ts:184` already sniffs content-type to guess around. Add:

```ts
if (pathname.startsWith("/api/extension")) return true;
if (pathname.startsWith("/api/ai")) return true;
```

Chosen over "let a `Bearer kx_` header through", because the Edge proxy cannot verify that header —
a wrong-but-present one would reach a route that 401s anyway, which is the same outcome with more
code and a second, unverifiable notion of "authenticated" in the Edge runtime.

Cookie reuse is not a shortcut: the NextAuth cookie is httpOnly + `SameSite=Lax`, and an
extension-page fetch is cross-site. Bearer is the correct call.

### 2.2 Device flow, two codes

```
extension SW                         KAIROS
POST /api/extension/pair/start  ──►  mint deviceCode(32B) + userCode("KAIR-7QX4"), 10min TTL
                                ◄──  { deviceCode, userCode, verificationUriComplete, interval:2 }
open verificationUriComplete ─────►  /extension/approve?code=… (cookie-gated page)
                                ◄──  credentials.approvePairing({ userCode })
POST /api/extension/pair/poll   ──►  match sha256(deviceCode); mint token in one tx
  { deviceCode } every 2s       ◄──  { status:"ok", token, expiresAt, account:{email,name} }
```

**Why two codes closes the poll race.** `userCode` is 8 characters — low entropy by necessity,
it gets read aloud — and is **never accepted by `/pair/poll`**. `deviceCode` is 32 bytes of
`randomBytes` and is the only credential poll accepts. Someone who shoulder-surfs or brute-forces
a `userCode` therefore cannot poll. The residual risk runs the other way: tricking a victim into
approving *your* code gives the victim's account to your extension. Mitigated by naming the device
and account on the approval page in the imperative ("Connect Chrome on Windows 11 to
ttuncheva@…?"), showing the paired email prominently in the extension afterwards, and
IP-rate-limiting `/pair/start` so codes cannot be farmed.

Codes are **server-generated** — same wire exposure either way, but it removes any dependence on
the extension's RNG and lets the server guarantee entropy and uniqueness.

Approval and redemption both use the **conditional-`UPDATE`-`RETURNING` claim** already proven in
`runDueSchedules` (`scheduled/runner.ts`): zero rows returned means already-approved / denied /
expired / unknown, all reported identically. Redemption sets `token_id` inside one transaction, so
a replayed poll cannot mint a second token. Accepted trade-off, stated explicitly: if the success
response is lost in flight the token exists but the extension never saw it — an orphan, listed and
revocable in settings, expiring on its own. Better than storing the plaintext token so it can be
re-served.

**Approval is never a GET** — a GET approval endpoint is one-click CSRF. It goes through the tRPC
mutation, inheriting tRPC's JSON content-type requirement and the `SameSite=Lax` cookie.

| Route (all new, `runtime = "nodejs"`) | Auth | Rate limit key |
|---|---|---|
| `POST /api/extension/pair/start` | none | `ext:start:${ip}` — 10/hr |
| `POST /api/extension/pair/poll` | device code | `ext:poll:${hash16}` 60/10min + `ext:poll:ip:${ip}` 600/hr |
| `POST /api/extension/revoke` | Bearer | `ext:revoke:${userId}` — 20/hr |
| `GET /api/extension/me` | Bearer | none (one indexed read) |
| `GET /extension/approve` (page) | session | — |

An unknown device code returns `expired`, indistinguishable from a real expiry, so polling cannot
enumerate. `429` carries `Retry-After` (the device flow's `slow_down`); the extension widens its
interval. All limits use the existing `readWindow`/`recordHit` from `security/slidingWindow.ts`.

`GET /api/extension/me` returns `{ userId, email, name, providerSource, rateLimit, latestExtensionVersion }`.
The extension needs this at startup: with BYOK, "AI is not configured" is a *per-user* state, and
the extension must render "add your key" without firing a turn and getting a 500.

### 2.3 `resolveActor` — `src/server/auth/resolveActor.ts` (new)

`Bearer first, then session` — deliberately inverting the obvious order. If the extension's fetch
ever sends cookies and the browser is signed into a *different* KAIROS account than the token was
minted for, session-first would silently run the turn as the wrong user. An explicit credential
should beat an ambient one, and correctness then doesn't depend on the extension remembering
`credentials: "omit"` (which it should still do).

- Require the literal shape `Bearer kx_…` — a garbage header is rejected without a DB hit, and the
  prefix makes the credential greppable by secret scanners.
- `sha256(token)` → **one indexed equality select** joined to `users`, with `revoked_at IS NULL AND
  expires_at > now()`. Indexed equality is the constant-time-equivalent here: the attacker cannot
  steer the hash, so there is no comparison oracle. Do *not* fetch candidates and compare in Node.
- Touch `last_used_at` throttled to one write per 5 minutes, as a single guarded `UPDATE` so it
  costs no extra read.

**Session synthesis — reuse, don't reinvent.** `systemContextFor`
(`src/server/llm/scheduled/systemContext.ts:61-75`) already mints a synthetic session and its
header comment already argues the safety case. Extract it to `src/server/auth/actorSession.ts` as
`sessionForUser(...)`, have both callers use it.

**Is it safe for `protectedProcedure`?** Yes, countably. `protectedProcedure`
(`src/server/api/trpc.ts:131-144`) checks only `ctx.session?.user`. Grepping `session.user.*` reads
across `src/server/llm/**`, `src/server/api/authz.ts`, and `src/server/orgs/**` returns **13 reads,
all `session?.user?.id`** — nothing reads `expires`, `email`, or `image` for an authorization
decision. So `assertProjectAccess` / `assertProjectPermission` / membership lookups / the note lock
all apply unchanged. Set `expires` to the token's real `expiresAt` so the field is truthful if
anything ever starts reading it.

`createTRPCContext` keeps `session` as the field all ~300 procedures read, so **nothing else in the
API changes**; `actor` is additive, for the BYOK decision and audit. Note it's also called from
`src/trpc/server.ts:21` for RSC, where there's no `Authorization` header — no behaviour change.

### 2.4 What a token can do — the one risk you accepted

Per the full-parity decision there is no procedure scoping: a paired token has exactly the
authority of a signed-in session, which includes A5 org-admin role changes and
`settings.deleteAllData`. `chrome.storage.local` is **plaintext on disk**, readable by anything
with access to the Chrome profile; MV3 has no secure-storage API. Containment is the 90-day expiry,
the per-token revoke list plus revoke-all, `last_used_at` for spotting unexpected use, and
draft→confirm→apply meaning nothing is written without an explicit click.

**Recommended hardening that costs zero agent parity:** deny a 3–4 entry list of
account-destroying *non-agent* procedures for bearer sessions (`settings.deleteAllData`,
`organization.delete`, password/email mutations). These are not agent features and the extension
has no UI for them, so all five agents and all handoffs stay fully intact. Strike this if you'd
rather keep the surface identical — it is your call, and the plan works either way.

---

## Part 3 — Server: the Vercel 60s deadline

Add `export const maxDuration = 60` (static literal — Vercel reads it at build time) to:

- `src/app/api/ai/chat/route.ts`
- **`src/app/api/trpc/[trpc]/route.ts` — easy to miss.** `projectChatbot`, `draft`, and all six
  `*Draft` mutations call the model over tRPC. This file declares no `runtime` and no
  `maxDuration`, so it inherits Hobby's **10s default** and every AI mutation would fail. Add
  `export const runtime = "nodejs"` here explicitly too.

New env var `AI_TURN_BUDGET_MS` (default `90_000`, preserving today's `DEFAULT_WALL_CLOCK_MS`
exactly); Vercel deploys set `45000`. Self-hosted `server.ts` ignores `maxDuration` entirely, so
there is no self-hosted regression. While here: `security/rateLimit.ts:24` and `:119` read
`process.env` directly, making the zod coercion in `src/env.js` decorative — fix to `env.*`.

**`ToolLoopOptions.wallClockMs` already exists** (`toolLoop.ts:85-86`, honoured at `:265-266`) and
**no caller sets it**. The seam is there; only the default source changes. But the loop budget
alone is insufficient — a real turn is context build + tool loop + up to 2 JSON-repair rounds + up
to 3 sub-agents + persistence + **two fast-tier calls inside `after()`**, and on Vercel `after()`
work counts against `maxDuration`. So a turn-level deadline on the same `TurnContext`, checked at
five places:

| Where | Change |
|---|---|
| `toolLoop.ts:266` | `Math.min(opts.wallClockMs ?? env.AI_TURN_BUDGET_MS, currentTurn()?.deadlineAt ?? Infinity)`. The existing `outOfTime` check at `:279` already drops tools and forces an answer — reused unchanged. |
| `modelClient.ts:574, :790` | `Math.min(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, msRemaining())`. **Highest-value single line:** `DEFAULT_TIMEOUT_MS = 120_000` is *twice* the whole Vercel budget, so one stalled upstream call currently eats the function and the user gets a platform 504 with no SSE frame at all. |
| `jsonRepair.ts:140` | Skip the repair round below 8s remaining; `a1Concierge.ts:131-148` already has a graceful failure branch. |
| `handoff.ts:244` | Below 10s remaining, skip the sub-agent and push into `handoffErrors` — `runAgentTurn` already tolerates per-handoff failure by design. |
| `chat/route.ts:195-200` | Skip `ensureTitle`/`maybeSummarize` below 6s. Both are already best-effort and try/catch-wrapped. |

One `AbortController` aborting on either `request.signal` or a `setTimeout(budget)`, replacing the
raw `request.signal` at `:160`. Wire it manually rather than `AbortSignal.any` — `withTimeout`
(`:503-540`) deliberately does so for Node-version reasons; follow that.

**What the SSE emits.** A new `deadline` frame (telemetry; `useAgentStream.ts:240-246` silently
ignores unknown events, so old web clients drop it) then a terminal `error` frame with
`code: "DEADLINE_EXCEEDED"` and an honest message. The web chat shows it with no code change; the
extension branches on `code` to keep the partial `answer_delta` text and offer Continue rather than
a red error.

**And do not persist a half-answer as complete.** On deadline, skip the assistant-message write at
`:176-188`. Writing a truncated `A1Output` puts a half-formed answer into `loadHistory`, which the
next turn replays as the model's own considered output. The user message was already written at
`:132`, so the conversation shows an unanswered user turn — which is exactly what happened.

## Part 4 — Server: rate limiting with BYOK

**Keep the limiter; make the ceiling depend on who pays.** `rateLimit.ts`'s own header says its job
is capping spend, and with a user's own key KAIROS's marginal cost is zero. But two jobs remain:
KAIROS's own compute (up to 8 model round trips and `TOOL_CONCURRENCY = 4` concurrent DB tools
against a pool of **`max: 3`** in `src/server/db/index.ts:19`), and abuse containment (a stolen
token plus a user-supplied `baseUrl` is an unbounded outbound-request generator; §1.2's allowlist
bounds the destination, not the volume).

- `AI_RATE_LIMIT` (50) — turns on the *server's* key. Unchanged.
- New `AI_RATE_LIMIT_BYOK` (500) — turns on the *user's* key.
- **One window (`ai:${userId}`), two limits.** Two windows would hand a user two budgets by
  toggling their key. `RateLimitOptions { byok?: boolean }` defaults to `false`, so **every
  existing call site is behaviourally unchanged**.

Ordering in the `aiProcedure` middleware: load the row once → decide `byok` from `row !== null` →
`consumeRateLimit` → only then decrypt. One read, one decrypt, and **no decrypt at all on a refused
request**, so a rate-limited caller never causes plaintext to exist in memory.

`rateLimitStatus` gains `keySource: "user"|"env"|"none"` via `hasUserLlmCredentials` (existence
only, never a decrypt on a status poll). Three honest strings: "412 of 500 left — your own key" /
"38 of 50 left — KAIROS's key" / **"No API key configured"** — the important new state.

---

## Part 5 — The extension

### 5.1 Manifest and permissions

`extension/src/manifest.ts`, typed, emitted to `dist/manifest.json` at build so origin and version
come from one place. `minimum_chrome_version: 116` (when `sidePanel.open()` landed — the whole
popup design in §5.2 depends on it, so declaring it turns a silent runtime failure into a refused
install).

```json
"permissions": ["storage", "sidePanel", "contextMenus"],
"host_permissions": ["https://<kairos-origin>/*"]
```

- `storage` — settings, token, read cache. `sidePanel` — required to register a panel and call
  `open()`. `contextMenus` — what makes `info.selectionText` available. `host_permissions` — the
  only network destination, and what lets extension fetch reach a cross-origin host with no server
  CORS layer. `omnibox` is a manifest key, **not a permission** — free in the install prompt.
- **`activeTab` and `scripting` confirmed unnecessary.** `contextMenus.onClicked` delivers
  `info.selectionText` from the browser's own selection state — not an injected page read.
  `chrome.tabs.create({url})` needs no permission (the `tabs` permission only gates *reading*
  `url`/`title`). Consequence accepted knowingly: **captures carry no source link**, because
  `info.pageUrl` is deliberately discarded. Also rejected: `alarms`, `notifications`, `identity`,
  `cookies`.
- Declare `content_security_policy.extension_pages` pinning `connect-src` to `'self'` plus the
  KAIROS origin — that turns "the extension accidentally talks to a third party" from a review
  question into a browser-enforced impossibility. **Trap:** MV3's default has *no* `connect-src`
  restriction, so the moment you write your own policy you must name the origin or every fetch dies.

**Pin the extension ID with the `key` field.** An unpacked extension's ID is
`SHA-256(directory path)`; with `key` it derives from the public key and becomes path-independent.
This matters because §5.6 updates by re-downloading a zip — without `key`, unzipping to a new
folder changes the ID, empties `chrome.storage.local`, and **forces re-pairing on every update.**
It also keeps `externally_connectable` and a CORS fallback available. Trade-off stated: the `key`
is public and committable, so anyone can fork and build with the same identity — the server must
never treat the extension ID as proof of anything. The bearer token is the only credential.

**The server origin is a build-time constant, not a setting.** Making it runtime-configurable needs
`optional_host_permissions: ["https://*/*"]`, which breaks the narrow-permission requirement. Dev
builds use a separate manifest adding `http://localhost:3000/*`.

### 5.2 The SSE-in-MV3 problem — the hardest issue

**The streaming fetch always runs in the side panel document. Never in the service worker.**

The SW's 30s idle timer resets on API calls, and keep-alive-via-port has worked, then not worked,
then worked again across Chrome versions. A design whose correctness depends on the user's Chrome
build is not a design — and a turn here can legitimately run the full 60s (up to three sequential
sub-agent handoffs, `handoff.ts:46`). The side panel is a normal extension page with a real
document, not subject to worker termination, and it is the only surface where the user can actually
watch a 60-second turn. The thing holding the connection is the thing rendering it.

**The popup problem, cleanly solved.** A popup is destroyed the instant it loses focus, so it can
never hold a turn — and doesn't need to. `chrome.sidePanel.open({windowId})` is callable from a
popup (a click is a user gesture). Submit becomes: write `pendingIntent` to
`chrome.storage.session` → `await sidePanel.open()` → `window.close()`. The popup dies immediately
and the turn is unaffected because the popup never started it; the panel does, on seeing the
intent. The user gets a watchable turn instead of a fire-and-forget. Same mechanism for the context
menu.

**Omnibox is the weak spot.** `onInputEntered` is not a documented gesture context, so `open()` may
reject. Fallback: keep the intent → `action.setBadgeText({text:"1"})` → next action click shows the
popup offering "Open planner to finish". A badge is not a notification. Do **not** fall back to
`tabs.create` with the text in the URL — that puts user content in a query string.

Rejected: `chrome.offscreen` — the `reason` enum has no honest entry for "hold a long fetch", only
one such document can exist, and it adds a permission for a capability nobody asked for.

**Message bus: `chrome.storage`, not ports and not `sendMessage`.** A port needs both ends alive,
which is the entire problem. `runtime.sendMessage` throws "Receiving end does not exist" when the
panel is closed — precisely the case that must work. A storage write never fails for lack of a
listener, and `onChanged` fires in whichever contexts are alive, including a panel created
milliseconds later.

```
chrome.storage.session   pendingIntent {id, source, text, projectId, agentId}
                         activeTurn {intentId, phase, answerText, toolCalls[], plans[], error?}
chrome.storage.local     auth {token, pairedAt, userLabel}
                         settings {defaultProjectId, locale, pinnedAgentId}
                         cache {projects, tasksByProject, agents, quota, activeOrgFingerprint}
```

Single writer per key: **SW** owns `pendingIntent` and badge state, **panel** owns `activeTurn` and
`cache`, **options** owns `auth` and `settings`. No locking, no lost updates.

**When the panel closes mid-turn** — verified and worse than it looks. `route.ts:116` consumed a
rate-limit unit and `:132` persisted the *user* message, both before the stream opened; the
assistant message is written in `after()` only after `result`. So an aborted turn **costs a quota
unit and leaves a dangling user message with no reply.** The panel document dies without warning,
so there is no cleanup hook — instead, on boot, `activeTurn.phase === "streaming"` means the
previous run died: mark `interrupted`, and on rehydration render a trailing user message with no
assistant reply as "Interrupted — resend?", saying that resending costs another unit.

**SSE parsing.** `EventSource` is unusable twice over — no `Authorization` header, no POST body.
There is already a working parser: `parseFrames` at `src/hooks/useAgentStream.ts:111`. **Extract it
to a pure `src/lib/agentStream.ts`** (no React, no server imports) and have both the hook and the
extension import it, so web and extension can never disagree about the wire format. Harden while
extracting:

1. `TextDecoder` with `{stream: true}` per chunk plus a final flush. Not theoretical: `bg` is a
   shipped locale and a 2-byte Cyrillic character split across a boundary becomes U+FFFD. The
   existing code does this right (`:203`) — preserve it.
2. Residual buffer; split on blank line; `chunks.pop()` is the incomplete tail, carried forward.
   Existing code is correct.
3. Normalise `\r\n` → `\n`, holding back a lone trailing `\r`. Belt-and-braces (the server writes
   `\n\n` at `route.ts:68`) but four lines.
4. Strip **exactly one** leading space after `data:`, not `.trim()`. Current `.trim()` is harmless
   for `JSON.stringify` output but wrong per spec.
5. **An unterminated tail after `done` is dropped, never dispatched** — exactly the Vercel-deadline
   case. A half-frame must not parse as a whole one.
6. Terminal events: `result`, `error`, `deadline`. Stream ends with none → `interrupted`.
7. Pre-stream checks in order: `!response.ok` → parse `{error, code}`, `429` → rate-limited; then
   `content-type` must include `text/event-stream`, else the proxy redirected us to HTML → "not
   paired / token rejected" (`useAgentStream.ts:184` learned this the hard way).

### 5.3 Surfaces and features

**Side panel** — header (project selector · agent picker · connection dot · quota chip · settings),
then four views:

1. **Today** — `task.getForCalendar({from, to})`, which is cross-organisation so it escapes the
   active-org narrowing that bites the project list. Overdue / today / this week.
2. **Project** — `task.getByProject({projectId})`, inline status via `task.updateStatus`. Writes
   are online-only; offline serves cache behind a read-only band.
3. **Conversation** — `agent.conversations` / `agent.conversation`. **Critical rehydration detail:**
   assistant messages are stored as `JSON.stringify(result.a1)` (`route.ts:182`), so `content` must
   be JSON-parsed into an `A1Output` and rendered as `answer.summary` + `clarify` + `citations` +
   `followUps`, with a raw-text fallback — same as `ProjectIntelligenceChat.tsx:811`. Citations use
   the `citationHref` map already exported from `useAgentStream.ts:62`, prefixed with the origin and
   opened via `chrome.tabs.create`.
4. **Draft review** (sheet, a **stack** — a turn can produce up to three plans).

**Draft review against the real schema** (`schemas/a2TaskPlannerSchemas.ts`, pure zod):

- **`scope.projectId` absent → no Apply button at all.** The schema comment (:104-111) says this is
  the questions-only plan that is never persisted. Render as a question card.
- `questionsForUser[]` first, as a reply box resending with `priorTaskDraftId = draftId` — the E-3
  refinement path (`route.ts:100`), so "push the third one to Friday" revises this plan instead of
  drafting a second beside it.
- **`diffPreview` is model-authored prose with `.default([])`. Never derive counts from it** —
  counts come from the operation arrays' `.length`. Show its strings positionally only when lengths
  match. Trusting `diffPreview` is how you build a UI that says "3 changes" and applies 7.
- `creates[]` — `dueDate` matches `/^\d{4}-\d{2}-\d{2}(T…)?$/`, so **date-only is legal**: render
  without a time rather than inventing midnight UTC. `clientRequestId` is server-assigned (:28-35)
  and must never be shown or edited.
- `updates[]` — "before" isn't in the plan; join `taskId` against `task.getByProject`. Missing →
  "current value unknown", never fabricate. `patch.assignedToId` is `.nullable()`, so explicit
  `null` renders as **"unassign"**, not blank.
- `deletes[]` — quarantined section. `dangerous` is a plain boolean here (A3's is `z.literal(true)`)
  and the comment says it must be true to be considered at all, so **`dangerous: false` renders as
  "proposed but not marked dangerous — will not be applied"**, greyed, excluded from counts. Any
  `dangerous: true` delete disables Apply behind a separate checkbox. `reason` is `min(1)` —
  display verbatim.

**One Apply button, not two.** Verified: `taskPlannerConfirm` requires `status === "draft"`
(`a2TaskPlanner.ts:334`), flips to `confirmed`, and mints a token expiring in 10 minutes (`:343`);
`taskPlannerApply` requires `status === "confirmed"` and an unexpired token (`:378`, `:398`). **So a
confirmed draft whose token expires is permanently dead — it can neither be re-confirmed nor
applied.** The web UI's two-button flow (`ProjectIntelligenceChat.tsx:1832` → `:1902`) can strand a
plan if the user walks away for eleven minutes. The extension calls confirm→apply as one action
under one spinner, making the window unreachable. Then Undo via `agent.undoAvailability` /
`agent.undoApply` with the `UNDO_WINDOW_MS` countdown (`undo.ts:49`). Corollary: **no offline apply
queue** — a queued apply would expire before it flushed.

> **Worth fixing server-side too:** allow re-confirm from `confirmed`. It's a live bug in the web
> app, not just an extension concern.

**Four plan renderers, because parity means four.** `notes` (`operations[]` discriminated union;
`notesVaultConfirm` uniquely accepts `edits: [{index, content}]`, so creates/updates get inline
textareas; `blocked[]` renders as "skipped: locked"), `events` (seven operation types), `org` (role
and permission changes, read-only + Apply). One `<OperationList>` shell plus four per-kind
renderers. **If schedule pressure appears, the honest cut is to ship tasks and notes fully and
render events/org as read-only summaries with Apply — not to fake parity.**

**Popup** — autofocused textarea, Enter to send, target-project chip, agent chip. Offline it
refuses with "captures need a connection" — **no outbox**, because a queue of unsent captures is a
local-only concept by another name.

**Omnibox** — keyword `kai`. Suggestions come **from cache only, no network per keystroke** — a
latency *and* privacy property: keystrokes go nowhere until Enter. `#project` retargets, `@agent`
pins. **Escape `& < >` in every `description`** — omnibox descriptions are a tiny XML dialect, and
unescaped user text breaks rendering or silently drops the suggestion.

**Context menu** — one item, `{title: 'Add "%s" to KAIROS', contexts: ["selection"]}`. `%s` is
substituted by Chrome with a truncated selection — free polish. Clamp to the server's
`MAX_MESSAGE_CHARS = 20_000` (`route.ts:55`), then auto-send: safe precisely because nothing is
written without draft→confirm→apply. Re-localised via `contextMenus.update` when the language
setting changes.

**Agent picker** — mirror `src/components/agents/AgentPicker.tsx`. Two verified details:
`"__auto__"` is a client sentinel that maps to **omitting `agentId` entirely**, not sending the
string; and the web picker lets you select `workspace_concierge` which the server silently
downgrades to Auto (`isPinnable`, `registry.ts:164`, excludes A1 by design) — mirror it but add a
"same as Auto" tooltip so the extension isn't quietly lying. `registry.ts` has `import "server-only"`
and cannot be imported, but `HANDOFF_TARGETS = TargetAgentSchema.options` (`:61`) and that schema
lives in the pure `a1WorkspaceConciergeSchemas.ts`.

**Panel states, all nine:** not-paired · loading · streaming · offline · no-API-key-configured
(per-user now) · rate-limited · deadline-hit · draft-awaiting-confirm · interrupted.

### 5.4 Which project a capture targets

Default chosen **at pairing** (pairing isn't complete until one exists), switchable per capture via
the chip; last-used becomes sticky. Zero projects → pairing completes but capture is disabled with
a deep link to `/projects`.

**The org-switching trap (verified).** `project.getMyProjects` resolves
`users.activeOrganizationId` from the DB (`routers/project.ts:98-127`) and lists only that org's
projects. The extension sends no org header and cannot influence this, so **the project list
silently changes when the user switches organisation on the web**, and a cached `defaultProjectId`
can point at a project that is no longer listed — sending it yields `assertProjectPermission` →
FORBIDDEN, surfacing as an opaque error. Cache an `activeOrgFingerprint` (hash of the returned id
list); when the default is absent from a refresh, **mark it stale and prompt** rather than sending
an id the server will reject. Offer `project.getAllProjectsAcrossOrgs` as a secondary "all
workspaces" list, noting that capturing there requires switching org on the web.

Also expose an explicit "let KAIROS decide" chip — `route.ts:94` coerces a non-numeric `projectId`
to `null` and A2 resolves it itself — labelled "may ask which project".

### 5.5 Build and code sharing

**Vite alone, without `@crxjs/vite-plugin`.** `vite` and `@vitejs/plugin-react` are already
devDependencies via vitest, and `tailwindcss@4` is already there; the only genuinely new deps are
`@tailwindcss/vite`, `@types/chrome`, and `archiver`. CRXJS would add HMR but has had long
maintenance gaps and its MV3 service-worker HMR is historically the flakiest part. Use
`rollupOptions.input` for the three HTML entries plus a single-file `format: "es"` SW entry, and a
~30-line `writeBundle` plugin emitting the manifest. Reload-on-change via `vite build --watch` plus
one click is acceptable friction for a tool distributed this way. React is the right call — four
plan kinds, nested operation arrays, inline editing, nine states.

**`extension/` with its own `package.json` and lockfile. No `pnpm-workspace.yaml` in phase 1.**
Adding one rewrites the existing 290 KB `pnpm-lock.yaml` into workspace shape — one large
unreviewable diff — and nothing here needs a real shared package, because everything shareable is
reachable by relative path. (`.npmrc`'s `public-hoist-pattern` still hoists to the same directory,
so editor config keeps working — that was the one thing that could have broken.) Root scripts shell
in: `ext:dev`, `ext:build`, `ext:zip`, `ext:check`, `ext:test`. `extension/tsconfig.json` extends
the root and maps `~/*` → `../src/*`, matched by a `resolve.alias`.

**ESLint cost, verified:** `eslint.config.js` sets `parserOptions.projectService: true` with
`recommendedTypeChecked`, so `eslint .` from the root would type-lint `extension/**` under the
app's Next/Drizzle rules and error on files not in a registered project. Add `extension/**` to the
root `ignores` and give the extension its own flat config.

**What is genuinely shareable** — verified by reading imports:

| Module | Imports | Share? |
|---|---|---|
| `schemas/a1…`, `a2…`, `a3…`, `a4…`, `taskGenerationSchemas` | `zod` only | **Yes** |
| `schemas/a5OrgAdminSchemas` | `zod` + `~/lib/permissions` (verified zero imports) | **Yes** |
| `agents/registry.ts` | `import "server-only"` | **No** — use `agent.agents` at runtime |
| `api/root.ts` | `server-only`, db, `~/env` | **Type-only** |

`import type { AppRouter }` is fully erased (`verbatimModuleSyntax` + Rollup emits nothing), so
`createTRPCClient<AppRouter>` gives zero-drift types. Cost is at *typecheck* time — the extension's
program then resolves the whole server graph, tolerable with `skipLibCheck`. Make the erasure
**guaranteed rather than assumed** with a Vite plugin that fails the build if any module under
`src/server/` other than `src/server/llm/schemas/` appears in the bundle graph, plus a matching
`no-restricted-imports` rule. One accidental non-type import is otherwise a silent way to ship
server code into a browser extension. Fallback if resolving server deps from `extension/` proves
painful: a hand-written narrow router shape validated by the shared zod schemas, with a type-level
assertion in `tests/extension/serverContract.test.ts` (which lives in the root program, where
`AppRouter` *is* importable, so drift breaks typecheck).

**Two non-negotiables for the client:** the transformer is **SuperJSON** (`trpc.ts:55`) and it
matters concretely (`task.getForCalendar` takes `z.date()`, `loadConversation` returns `Date`); and
send `x-trpc-source: chrome-extension` so server logs can tell the clients apart.

**Styling:** extract the token layer from `src/styles/globals.css` (the `@custom-variant dark`,
`@theme inline` block, and `:root`/`.dark`/`[data-accent]` sets) into `src/styles/tokens.css`,
`@import`ed by both. The extension then matches KAIROS exactly, including all six accent themes,
for one pure-CSS move. Order matters (`@theme inline` before any use). `tailwind.config.js` is
vestigial under v4 — nothing loads it without `@config`.

**i18n:** add an `extension` namespace to `src/i18n/messages/{en,bg}.json`, and a build step that
generates `extension/src/locales/{en,bg}.json` containing only the `extension` and `agents`
namespaces (`en.json` is 58 KB and `bg.json` 84 KB — far too much for a popup bundle). The existing
`tests/i18n/translations.test.ts` key-parity guarantee then covers extension strings for free. Use
a 20-line `t()`, **not** `chrome.i18n`/`_locales`, which follows the browser UI language and can't
be switched from the options page — the two exceptions are the context-menu title and action
tooltip, set at startup from the stored locale. `en` and `bg` only; `de/es/fr` are in
`INCOMPLETE_LOCALES` for reasons `src/i18n/locales.ts` documents at length.

### 5.6 Packaging and release

Zip the **contents** of `dist/` with `manifest.json` at the **archive root** — nesting it inside a
`dist/` folder is the single most common "Load unpacked fails" report. No sourcemaps. Use
`archiver` in `extension/scripts/zip.mjs`, not the `zip` CLI (absent on Windows, and this repo is
developed on Windows 11) or `Compress-Archive` (not portable to Linux CI).

There is **no `.github/` directory and no CI at all** today (the root README's references to it are
stale). Add `.github/workflows/extension-release.yml` on tags `ext-v*` (check → test → build → zip
→ attach zip **and its SHA-256**), plus a plain CI workflow running
`pnpm check && pnpm test && pnpm ext:check && pnpm ext:test`.

`extension/README.md`: download, **unzip to a folder you will keep** (not Downloads),
`chrome://extensions` → Developer mode → Load unpacked, then Connect to KAIROS.

**Updating is manual — say it plainly.** No auto-update, no CWS. Two mitigations: pinning `key`
(§5.1) means re-unzipping over the same folder keeps the ID and the pairing; and
`latestExtensionVersion` on `/api/extension/me` drives an "update available" chip with **no new
permission** (checking GitHub's API directly would need `api.github.com` in `host_permissions`).
Document the Developer Mode warning bubble Chrome shows on every launch — there is no supported way
to suppress it — and that managed/enterprise profiles may block unpacked extensions entirely via
policy, with no workaround short of the Web Store.

### 5.7 Testing

**Pure, no `chrome` mock** — and these are the highest-value tests in the project:

- **SSE parser.** Feed `Uint8Array` chunks, not strings: split inside `event:`, inside `data:`,
  exactly at `\n\n`, and **through a multi-byte Cyrillic character**. Plus heartbeat comments,
  unknown event names, `data:` with and without the leading space, multi-line `data:`, and an
  unterminated tail after `done` (must be dropped).
- **Turn reducer** — the pathological orders: `result` with no deltas, `error` after deltas, stream
  end with no terminal event, `deadline` mid-stream with `plans[]` already present.
- **Draft-review derivation**, driven from the real zod schemas so a schema change breaks the test:
  `diffPreview` disagreeing with the arrays, `dangerous: false` suppression, missing
  `scope.projectId`, `assignedToId: null` → "unassign", date-only `dueDate`.
- Cache staleness / org-fingerprint invalidation; omnibox escaping.

**Needs a mocked `chrome`:** the SW event router (including `sidePanel.open()` *rejecting*), the
popup handoff, storage fan-out, badge state. **Write the double yourself** —
`extension/tests/fakeChrome.ts`, ~80 lines with a real `onChanged` emitter. `sinon-chrome` and
`jest-webextension-mock` are both Jest-shaped and stale on MV3, and neither lets you make
`sidePanel.open()` reject on demand — the exact behaviour the omnibox fallback exists for.

**Tests live under `extension/` with its own `vitest.config.ts`.** The root config's
`setupFiles: ["./tests/setup.tsx"]` mocks `next-intl`, `next-auth/react`, `next/navigation`, and
`~/trpc/react` — irrelevant here and some actively harmful (the `~/trpc/react` mock would stub a
module the extension never imports, hiding real wiring bugs), and its `include` is hard-scoped to
`./tests/**`. One exception: `tests/extension/serverContract.test.ts` stays in the app's tree,
because only the root program can import `~/server/api/root`.

---

## Execution order

Server first. Nothing extension-side should start before phase C is green.

| Phase | Work | Done when |
|---|---|---|
| **A** | Env vars in `src/env.js` + `.env.example`; fix `rateLimit.ts` to read `env.*` | `pnpm check` passes |
| **B** | Crypto module + `credentials.ts` schema + migration (**hand-raise `when`**) + verify in psql | New tables exist; unit tests cover round-trip, wrong-AAD, tampered-tag, short-key mask |
| **C** | `turnContext.ts`, `llmConfig.ts`, `modelClient` edits, the three entry points | Empty store behaves exactly as today (existing `modelClient.test.ts` passes); a test asserts an `after()` callback sees the store |
| **D** | `providerProbe.ts`, `credentials` router, settings UI, i18n | **Independently shippable — BYOK works on the web before the extension exists**, which de-risks the encryption before any new auth surface |
| **E** | `actorSession.ts`, `resolveActor.ts`, four `/api/extension/*` routes, approval page, `createTRPCContext`, **the `proxy.ts` change** | `curl` with a bearer token streams `/api/ai/chat` and calls `agent.rateLimitStatus`; revoked/expired 401; second poll after redemption returns `expired`; two concurrent approvals of one code produce one token |
| **F** | `maxDuration`, the five deadline checks, `deadline`/`error` frames, skip-the-write | With `AI_TURN_BUDGET_MS=1`, SSE terminates `DEADLINE_EXCEEDED` and no assistant message is persisted |
| **G** | `RateLimitOptions`, `AI_RATE_LIMIT_BYOK`, `keySource` | Three honest quota strings render |
| **H** | **Two spikes, before building anything on them** (see risks 1–2) | Both answered yes/no |
| **I** | Shared seams: extract `agentStream.ts`, `tokens.css`, `extension` i18n namespace, eslint ignores | Web app unchanged, `pnpm test` green |
| **J** | Extension skeleton: package/tsconfig/vite/manifest, trpc client, storage layer, **server-import guard plugin** | Loads unpacked, says "not paired" |
| **K** | Pairing: options page, device flow, default-project pick, SW skeleton | Pair, then render real projects in the panel |
| **L** | Panel + streaming: shell, four views, nine states, live turn, rehydration, agent picker | A turn streams end to end and survives a popup close |
| **M** | Draft review: tasks renderer, one-button confirm→apply, Undo countdown, notes/events/org | A capture becomes real tasks |
| **N** | Popup, context menu, omnibox with badge fallback | Three capture paths work |
| **O** | Offline cache, org-fingerprint invalidation, quota chip, en/bg | — |
| **P** | `zip.mjs`, README, two workflows, version chip | A tagged release produces a loadable zip |

## Riskiest unknowns

1. **`sidePanel.open()` from a popup click.** The whole "turn survives the popup" design rests on
   it. It should work — a popup click is a user gesture, and this is a known pattern — but gesture
   propagation across the popup-closing boundary has had bugs. **Spike with a 20-line throwaway
   extension in phase H.** If it fails, the fallback is the offscreen document with its dishonest
   `reason`, which is a materially worse design.
2. **CORS from extension pages.** Extension-page and SW fetches to a `host_permissions` origin are
   expected to bypass CORS entirely — no preflight, no `Access-Control-Allow-Origin` — which is why
   no server CORS work is planned. **This holds only for the SW and extension pages;** a *content
   script* fetch runs in the page's origin and is subject to CORS. Hence: all network calls
   originate in extension contexts with `credentials: "omit"`. Verify in phase H alongside #1; if
   Chrome differs, the fix is `Access-Control-Allow-Origin: chrome-extension://<pinned-id>` plus an
   `OPTIONS` handler, which needs the pinned `key`.
3. **A bearer token is full account authority** and `chrome.storage.local` is plaintext on disk.
   See §2.4 for the accepted risk and the zero-parity-cost hardening on offer.
4. **The 60s deadline is a design constraint.** An aborted or cut turn still costs a quota unit and
   leaves a dangling user message; the extension surfaces that honestly but cannot fix it.
5. **`ws-server` has no home on Vercel**, so Daily Brief and Risk Radar don't run there. Flagged,
   not solved — a separate hosting decision.
6. **Four plan renderers is more UI than it sounds** in a 400px panel. The honest cut is stated in
   §5.3.
7. **The confirm-token trap is a live bug in the web app too.** Worth fixing server-side rather
   than routing around it in two clients.

## Verification

- `pnpm check` (lint + `tsc --noEmit`) and `pnpm test` at the root; `pnpm ext:check` and
  `pnpm ext:test` for the extension.
- Watch three existing tests: `tests/agents/toolLoop.test.ts` (`wallClockMs: -1` at :308 interacts
  with the new `Math.min`), `tests/agents/modelClient.test.ts` (mocks `~/env` at module scope —
  needs `AI_TURN_BUDGET_MS` added), `tests/agents/jsonRepair.test.ts`.
- End-to-end, against a deployed preview: add a provider key in settings → `testProvider` reports
  tool calling and streaming → pair the extension → highlight text on any page → right-click →
  the panel streams a plan → Apply creates real tasks visible in the web app → Undo removes them.
- Prove the isolation properties explicitly: the build fails if a `src/server/**` module outside
  `schemas/` enters the bundle; `chrome://extensions` shows only the KAIROS host permission; and
  the network panel shows no request to any other origin.
