# KAIROS — Codebase Audit

Branch `development` @ `cd2b171`. 218 files under `src/`, ~47k LOC of TS/TSX, plus a standalone `ws-server/`.

**Verification caveat:** `node_modules` is not installed in this checkout, so `tsc --noEmit`, `eslint`, and `vitest` could not be executed. All findings below are from source reading and are cited to specific files and lines.

---

## P0 — Cross-tenant data access

### 1. AI agent reads and writes any project by ID (no membership check)

**Problem.** The A1 read tool `listTasks` filters only on `projectId`, with an in-code admission that access control is missing. `buildA1Context` passes user-supplied `scope.projectId` straight into it. On the write side, `taskPlannerDraft` accepts `scope.projectId` / `handoffContext.projectId` with no authorization and persists a draft; `taskPlannerApply` then inserts, updates and deletes tasks scoped to `plan.scope.projectId`.

**Root cause.** Authorization lives inline in each tRPC router (`assertProjectAccess` in `chat.ts`, ad-hoc blocks in `task.ts`) and was never extended to the agent tool layer, which reaches the DB directly through `ctx.db`.

**Evidence.**
- `src/server/llm/tools/a1/readTools.ts:205-230` — `where = eq(tasks.projectId, input.projectId)`, preceded by the comment *"NOTE: This does not yet enforce project read access beyond direct membership."*
- `src/server/llm/context/a1ContextBuilder.ts:60-88` — `projectId` taken from `scope`, passed to `listTasks.execute` unvalidated.
- `src/server/api/routers/agent.ts:80-105` — `projectChatbot` accepts `projectId: z.number().optional()` and forwards it as `scope`.
- `src/server/llm/orchestrator/agentOrchestrator.ts:488-497` — `resolvedProjectId` assigned from input with no membership query; `:586-598` persists the draft.
- `src/server/llm/orchestrator/agentOrchestrator.ts:707-806` — apply loop inserts/updates/deletes against `plan.scope.projectId`.

**Second defect in the same path:** apply uses `plan.scope.projectId` — a value that round-trips through the LLM's JSON output — rather than `draft.projectId`, the value actually stored in `agent_task_planner_drafts`. The trusted column is read at `:677` and then used only for the audit row at `:815`.

**Impact.** Any authenticated user can enumerate project IDs and (a) read task titles, statuses, priorities and due dates from any organization's projects via the chat agent, and (b) create, modify and delete tasks in them. Full horizontal privilege escalation across tenants.

**Fix.** Extract the project-access check into one shared server helper (`assertProjectAccess(ctx, projectId, "read" | "write")` — `chat.ts:17-44` is the most complete existing version) and call it: at the top of `taskPlannerDraft`, inside every A1 read tool that takes an entity ID, and again in `taskPlannerApply` against `draft.projectId`. Make apply use `draft.projectId` and reject a plan whose `scope.projectId` disagrees.

**Effort.** M

---

### 2. WebSocket conversation rooms accept any join — live DM eavesdropping

**Problem.** `join:org` and `join:project` verify membership against the DB and hard-disconnect on failure. `join:conversation` does neither — it joins whatever ID is sent.

**Evidence.**
- `ws-server/rooms.ts:167-181` — `socket.on("join:conversation", …)` type-checks the ID and calls `socket.join()`. The comment claims *"user must be in conversation to receive messages"*, which is not true of a Socket.IO room.
- `src/server/socket/emit.ts:31` — `emitNewMessage` publishes full message bodies to `conversation:{id}`.
- `src/server/db/schemas/chat.ts:11` — conversation IDs are `generatedAlwaysAsIdentity()`, i.e. sequential and trivially enumerable.
- Contrast `chat.listMessages` (`src/server/api/routers/chat.ts:339`), which correctly rejects non-participants — so the tRPC read path is sound and only the socket path leaks.

Also unauthorized: `message:typing` (`ws-server/rooms.ts:183-204`) relays a typing indicator into any conversation room, letting an attacker inject spoofed presence.

**Impact.** Any authenticated user can join every conversation room in the system and receive private direct messages in real time as they are sent.

**Fix.** Mirror `handleJoinProject`: query `direct_conversations` for `userOneId = socket.data.userId OR userTwoId = socket.data.userId` before joining, and disconnect on failure. Gate `message:typing` on room membership (`socket.rooms.has(...)`).

**Effort.** S

---

### 3. Account-switch cookie is a password-free login that survives sign-out

**Problem.** The `account-switch` credentials provider signs a user in with nothing but a `userId`, validated against a 30-day cookie. The cookie is never cleared on sign-out, and the endpoint that lists its contents requires no session.

**Root cause.** A Google-style account switcher was built without the re-authentication step that makes that pattern safe.

**Evidence.**
- `src/server/auth/config.ts:64-104` — provider accepts `userId`, checks it appears in the decoded cookie, and returns the user. No password, no re-auth prompt.
- `src/app/api/account-switch/register/route.ts:45-52` — cookie set with `maxAge: 60*60*24*30`; accumulates up to 8 accounts.
- No `signOut` event or callback clears it — `grep -rn "ACCOUNT_SWITCH_COOKIE" src` shows only the two routes and the provider; `authConfig` has no `events.signOut`.
- `src/app/api/account-switch/list/route.ts:14-40` — `GET` with **no `auth()` call**, returns `userId`, `email`, `name`, `image` for every account on the browser.
- `src/proxy.ts:26` — `/api/account-switch/*` is explicitly in the public path list.

**Impact.** After any user signs out, anyone with access to that browser profile can `GET /api/account-switch/list` to enumerate previous users and then `signIn("account-switch", { userId })` to get a full session as any of them, with no credential. Shared workstations, kiosks, and stolen/restored browser profiles are all full-takeover scenarios. The unauthenticated list endpoint also discloses email addresses to any script that can reach it with the cookie attached.

**Fix.** Three changes: (a) add `events.signOut` to `authConfig` that deletes `kairos.accounts`; (b) require a session on `/api/account-switch/list` and return only entries other than the current user; (c) require re-authentication (password or fresh OAuth) when switching to an account that is not the currently-signed-in one — or drop the feature. Also add per-entry expiry inside the cookie payload rather than relying on cookie `maxAge` alone.

**Effort.** M

---

### 4. The `mentor` view-only role is enforced only in the browser

**Problem.** `src/lib/permissions.ts` defines a full role/permission matrix in which `mentor` cannot create, edit or delete anything. Nothing on the server ever consults it.

**Evidence.**
- `getPermissions` / `isViewOnlyRole` are imported by exactly one non-test file: `src/lib/useRolePermissions.ts:5` — a `"use client"` hook. Zero references in `src/server/**`.
- `src/server/api/routers/task.ts:104-135` (`create`), `:250-330` (`update`), `:345-410` (`delete`) — authorization ends at "is org member", never checks role.
- `src/server/api/routers/organization.ts:248` — `join` lets the caller self-select `role: "mentor"`, so the role is reachable by anyone with an access code.
- The `canDeleteTasks` column exists (`src/server/db/schemas/organizations.ts:41`) and is set on org creation (`organization.ts:219`) but is **never read** by `task.delete`.

**Impact.** A mentor — or any org member regardless of granted permission flags — can create, edit and delete every task and project in the organization by calling tRPC directly. The role UI, the `ViewOnlyBanner`, and the permission columns are decoration.

**Fix.** Add an `orgMemberProcedure` middleware in `src/server/api/trpc.ts` that loads the caller's `organization_members` row into `ctx` once, then a `requirePermission(ctx, "canDeleteTasks")` helper used by every mutation. Reconcile the two competing role vocabularies first (see #16).

**Effort.** L (touches every mutation; the middleware itself is S)

---

## P1 — Authentication and data integrity

### 5. Privilege escalation through `inviteMember`

**Problem.** `inviteMember` authorizes the caller as *admin **or** `canAddMembers`*, but then accepts an arbitrary `role` string and maps `"admin"` straight through to the DB enum.

**Evidence.** `src/server/api/routers/organization.ts:1001` (the permission check) and `:1059-1063` (`validRoles` includes `"admin"`, `dbRole` accepts it). Compare `updateMemberRole` at `:637`, which correctly requires `role === "admin" && canManageRoles` and blocks self-promotion at `:644-649`.

**Impact.** A non-admin member with the delegated `canAddMembers` flag can invite any address — including one they control — as `admin`, then accept and gain full org control.

**Fix.** Restrict the invitable roles by caller: only `caller.role === "admin" && caller.canManageRoles` may invite `"admin"`. Change the input to `z.enum([...])` instead of `z.string()`.

**Effort.** S

---

### 6. `users.email` has no unique constraint, and password reset updates by email

**Problem.** `email` is `notNull()` but not `.unique()`. Every auth path looks users up by email with `findFirst`, and the reset writes by email.

**Evidence.**
- `src/server/db/schemas/users.ts:27` — `email: d.varchar({ length: 255 }).notNull()`. No `.unique()`; no unique index in `migrations/`.
- `src/server/api/routers/auth.ts:31-56` — check-then-insert on signup, no constraint to make it atomic.
- `src/server/api/routers/auth.ts:207-210` — `update(users).set({ password }).where(eq(users.email, email))` — **unbounded by user ID**.
- `src/server/auth/config.ts:113-116` — credentials `authorize` uses `findFirst({ where: eq(users.email, ...) })`.

**Impact.** Concurrent signups create duplicate accounts for one address. Once duplicated: a password reset silently overwrites the password of *every* account with that email, and credentials login resolves to a nondeterministic row. The OAuth adapter can also create a second row for an address that already has a credentials account.

**Fix.** Add a unique index on `lower(email)`, de-duplicate existing rows first, and change `resetPassword` to write `.where(eq(users.id, user.id))`.

**Effort.** S (code) + M (data migration)

---

### 7. No email verification, combined with dangerous OAuth account linking

**Problem.** Signup marks the address verified without sending anything, and both OAuth providers link by email unconditionally.

**Evidence.**
- `src/server/api/routers/auth.ts:55` — `emailVerified: new Date()` set at signup.
- `src/server/db/schemas/users.ts:29-33` — column default is also `new Date()`.
- `src/server/auth/config.ts:47` and `:63` — `allowDangerousEmailAccountLinking: true` on Google and Microsoft Entra, the latter on the `common` tenant (personal accounts included).
- The only mail sent at signup is `sendWelcomeEmail` (`auth.ts:59`) — no verification token exists anywhere in the schema besides the NextAuth adapter table, which is unused under the JWT strategy.

**Impact.** An attacker registers `victim@company.com` with a password they choose. When the real owner later signs in with Google or Microsoft, the linking flag attaches that identity to the attacker's pre-existing row — the attacker's password now opens the victim's account. This is the documented reason the NextAuth option carries "dangerous" in its name.

**Fix.** Require email verification for credentials signup (`emailVerified: null` until a token is redeemed), and only allow OAuth linking to a row where `emailVerified` is non-null *and* the provider asserts a verified email. If linking is needed for the Edge cookie-partitioning problem cited in the comment at `config.ts:41-46`, solve that separately.

**Effort.** M

---

### 8. Credentials login has no rate limiting

**Problem.** `src/server/authRateLimit.ts` guards the tRPC auth router (signup, reset request, code verify, reset). Actual sign-in does not go through tRPC — it goes through the NextAuth credentials provider, which has no limiter.

**Evidence.** `consumeAuthRateLimit` is called only in `src/server/api/routers/auth.ts` (lines 30, 84, 130, 163). `src/server/auth/config.ts:106-140` — `authorize` has no limiter, no lockout, no failed-attempt counter. Note that the note-password PIN path *does* implement lockout (`note.ts:600-632`), so the pattern exists in the codebase.

**Impact.** Unlimited online password guessing against `/api/auth/callback/credentials`. Secondary effect: each attempt runs Argon2id at `memoryCost: 65536` (64 MB) with `parallelism: 4` — a few hundred concurrent attempts is also a memory-exhaustion DoS on the app server. The same unbounded-Argon2 exposure exists on `note.verifyPassword` (`note.ts:547`) and `note.getOne` (`note.ts:405-420`).

**Fix.** Wrap `authorize` with the existing `consumeAuthRateLimit` keyed on email **and** client IP, plus a persistent per-account failed-attempt lockout mirroring the reset-PIN implementation. Rate-limit `note.verifyPassword`/`getOne` the same way.

**Effort.** S

---

### 9. Every environment variable is optional, and the DB URL falls back to a hardcoded default

**Problem.** `src/env.js` declares all secrets `.optional()`, defeating the point of `@t3-oss/env-nextjs`. `db/index.ts` then substitutes a hardcoded connection string.

**Evidence.**
- `src/env.js:8-15` — `AUTH_SECRET`, `AUTH_GOOGLE_SECRET`, `DATABASE_URL` … all `z.string().optional()`.
- `src/server/db/index.ts:14-15` — `env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/kairos"`.
- `ws-server/rooms.ts:23-25` — the same hardcoded fallback, duplicated.
- Downstream: `src/server/auth/config.ts:31` passes possibly-`undefined` as `secret`; `src/app/api/account-switch/*` returns 500/empty when `AUTH_SECRET` is missing rather than failing loudly.
- `NEXT_PUBLIC_APP_URL` is declared under `server:` (`env.js:29`) rather than `client:`, so it is validated in the wrong scope.

Contrast `ws-server/index.ts:27-32`, which does the right thing: hard `process.exit(1)` when `WS_SECRET` is missing or under 32 chars.

**Impact.** A misconfigured production deploy boots successfully and silently connects to the wrong database or runs with an undefined auth secret, instead of crashing at startup. This is the failure mode that turns a config typo into a data incident.

**Fix.** Make `AUTH_SECRET` (min 32), `DATABASE_URL` (url), and `WS_SECRET` (min 32) required in `env.js`; remove both hardcoded fallbacks; move `NEXT_PUBLIC_APP_URL` to `client:`. Keep the rest optional only where the feature is genuinely optional (LLM, Resend), and have those features fail closed.

**Effort.** S

---

### 10. Updating a password-protected note silently destroys its encryption and bricks the note

**Problem.** `note.update` re-encrypts only when `input.password` is supplied. When it is not, the new content is written as plaintext into a row that still has `passwordHash` and `passwordSalt` set.

**Evidence.** `src/server/api/routers/note.ts:476-495` — `let storedContent = input.content;` then `if (note.passwordHash && note.passwordSalt && input.password) { … encryptContent(…) }`. No `else` branch, no rejection.

**Impact.** Two failures at once. (a) The note's content is now stored unencrypted while the UI still shows it as protected. (b) Every subsequent read path calls `decryptContent` on that plaintext and throws — `getOne` at `:428` and `verifyPassword` at `:557` both surface *"Failed to decrypt note content. The note may need to be re-saved."* The note becomes permanently unreadable through the product. Reachable both by the owner and by anyone holding a `write` note-share (`:461-474`), who is never asked for the note password.

**Related, by design but severe:** `resetPasswordWithPin` (`note.ts:663-676`) replaces the note body with the literal string `"[Content reset — please re-enter your note content]"`. A PIN reset is unrecoverable content loss, and the code comment acknowledges it.

**Fix.** Reject the update with `BAD_REQUEST` when `note.passwordHash` is set and no valid password is provided. Require the note password for write-shared protected notes. For the PIN path, either store a second copy of the content key wrapped by the PIN (so reset actually recovers content) or make the destructive behaviour explicit in the UI before it runs.

**Effort.** S (the guard) / M (PIN key-wrapping)

---

### 11. `ProjectChat` loops a mutation forever and polls twice per second

**Problem.** Two independent defects in one component.

**Evidence.** `src/components/projects/ProjectChat.tsx:50-57`:

```ts
useEffect(() => {
  if (!selectedUserId || getOrCreate.isPending) { … return; }
  void getOrCreate.mutateAsync({ projectId, otherUserId: selectedUserId });
}, [selectedUserId, projectId, getOrCreate.isPending, getOrCreate]);
```

`getOrCreate.isPending` is in the dependency array and the guard is the only thing gating the call. The effect fires → `isPending` flips `true` → effect re-runs and returns early → mutation settles → `isPending` flips `false` → effect re-runs and **fires the mutation again**. Nothing checks whether `conversationId` is already set.

`src/components/projects/ProjectChat.tsx:63` — `refetchInterval: 500` on `chat.listMessages.useInfiniteQuery`.

**Impact.** An open project chat issues an unbounded stream of `getOrCreateProjectConversation` mutations — each one running `assertProjectAccess` plus 3-4 more queries — for as long as the tab is open. On top of that, 2 req/s per open chat for message polling, in an app that already delivers messages over WebSocket (`emitNewMessage`). This is the most likely source of database load in the app.

**Fix.** Guard on `conversationId !== null` and drop `getOrCreate` from the deps (or move the call into the `selectedUserId` change handler). Remove `refetchInterval` entirely and rely on the `message:new` socket event, or set it to a sane fallback (30 s).

**Effort.** S

---

### 12. Migration history cannot build a database from scratch

**Problem.** The migrations folder is missing its first two SQL files while the meta snapshots for them exist, and three later snapshots are absent.

**Evidence.**
- `src/server/db/migrations/` — first SQL file is `0002_user_image_text.sql`; there is no `0000_*.sql` or `0001_*.sql`.
- `meta/_journal.json` — first entry is `{ idx: 0, tag: "0002_user_image_text" }`, and `idx` jumps 0 → 3.
- `meta/` contains `0000_snapshot.json` and `0001_snapshot.json` but no `0002`, `0010`, or `0014` snapshot, while those tags are in the journal.

**Impact.** `pnpm db:migrate` against an empty database fails or produces an incomplete schema. There is no reproducible way to provision a new environment, which means staging/CI/new-developer setup depends on `db:push` against a hand-built database — and nothing verifies that the deployed schema matches `schema.ts`.

**Aggravating factor:** `"postinstall": "npm run db:generate"` (`package.json:26`) runs `drizzle-kit generate` on every install. That can emit new migration files during a CI or production install, and it hardcodes `npm` in a repo that also carries `pnpm-lock.yaml`.

**Fix.** Squash the current schema into a fresh baseline migration (`drizzle-kit generate` against an empty DB), verify it applies cleanly to a blank Postgres, and commit the regenerated `meta/`. Remove the `postinstall` hook and run `db:generate` explicitly.

**Effort.** M

---

### 13. Most of the test suite asserts on source text, not behaviour

**Problem.** 23 of 49 test files `readFileSync` a source file and assert `toContain("someString")`. There are 383 `toContain`/`toMatch` assertions and **zero** tests that execute a tRPC procedure.

**Evidence.**
- `grep -rn "createCaller\|appRouter" tests` → 0 matches. No router is ever invoked.
- `tests/server/routerSecurity.test.ts:23-46` — a file titled "Router Security" whose per-router assertions are: source imports from `trpc`, source contains `createTRPCRouter`, source has no `db.execute(\`…${}\`)`, source has no `eval(`. None of these can detect a missing authorization check.
- `tests/lib/utils.test.ts:26-48` — `expect(permissionsSource).toContain("getPermissions")`, `toContain("mentor")`, and the same `"defines mentor role"` assertion duplicated at lines 30 and 38.
- Files affected: `accessibility`, `ChatAndPanel`, `EventFeed`, `NotesList`, `SettingsPage`, `SideNav`, `authConfig`, `authSecurity`, `font`, three `i18n/*`, `utils`, `PageAnimations`, `pagePatterns`, `eventNotifications`, `eventPagination`, `middleware`, `routerCompleteness`, `routerSecurity`, `schema`, `design-system`, `no-floating-circles`.

**Impact.** The suite is green while P0 items #1–#4 are live in the code — several of these tests are named as if they cover exactly those areas. It provides confidence without coverage, and it breaks on cosmetic refactors while missing real regressions. This is why the authorization gaps above went unnoticed.

**Fix.** Stand up `createCallerFactory` against a throwaway Postgres (testcontainers or a CI service container) and write integration tests per router that assert the negative case: non-member gets `FORBIDDEN`. Start with the four P0 paths — each becomes a regression test for the fix. Delete the source-grep tests rather than migrating them; keep only `tests/i18n/*` (key-parity checks are legitimately structural) and the genuine `@testing-library` component tests.

**Effort.** L

---

### 14. Two-factor authentication is a toggle that does nothing

**Problem.** `twoFactorEnabled` is stored, read, and rendered as a switch. No TOTP is ever generated, verified, or enforced.

**Evidence.** `twoFactorSecret` (`src/server/db/schemas/users.ts:70`) is never written anywhere — `grep -rn "twoFactorSecret" src` returns only the schema definition. `src/components/settings/SecuritySettingsClient.tsx:129-155` renders the toggle; `settings.updateSecurity` (`settings.ts:112-129`) and `settings.updatePrivacy` (`:197`) both just persist the boolean. `src/server/auth/config.ts` `authorize` never checks it.

**Impact.** Users who enable it believe their account requires a second factor and it does not. That is a misrepresentation of a security control, with obvious consequences if the product is ever used for anything regulated.

**Fix.** Remove the toggle from the UI and the field from the settings mutations until TOTP is implemented, or implement it (secret generation, QR enrolment, verification step in `authorize`, recovery codes).

**Effort.** S to remove / L to implement

---

## P2 — Maintainability, performance, hardening

### 15. Argon2 password hashes are sent to the browser

`note.getAll` (`src/server/api/routers/note.ts:114-121`) and `note.getSharedWithMe` (`:143`, `:156`) include `passwordHash` in the response — the latter ships an owner's note-password hash to every user the note is shared with. The client only needs a boolean.

**Fix:** return `isPasswordProtected: !!n.passwordHash`. **Effort:** S

---

### 16. Two incompatible role vocabularies, and permissions fail open

`orgRoleEnum` (`src/server/db/schemas/enums.ts:10`) holds five values from two different designs: `admin | member | guest` and `worker | mentor`. `src/lib/permissions.ts` only understands `admin | worker | mentor` and its `default` branch returns **`WORKER_PERMISSIONS`** — write access — for `member`, `guest`, and anything unrecognised (`permissions.ts:84-93`). `useRolePermissions` additionally returns full `admin` permissions whenever the profile query is still loading or the user is in personal mode (`useRolePermissions.ts:25-30`).

Meanwhile a *second*, orthogonal permission system exists as eight boolean columns on `organization_members` (`canAddMembers`, `canDeleteTasks`, …), plus a *third* in the `organization_roles` table. Different call sites consult different ones.

**Fix:** pick one model. Recommend: keep the boolean columns as the source of truth, derive them from role on membership creation, delete `src/lib/permissions.ts`'s role matrix, and make the unknown-role branch fail **closed**. **Effort:** M

---

### 17. Authorization logic is copy-pasted across routers

The same ~40-line "is owner → is org member → is write collaborator" block appears four times in `task.ts` alone (`:33-79`, `:168-200`, `:283-310`, `:360-390`), again as `assertProjectAccess` in `chat.ts:17-44`, and again in `ws-server/rooms.ts:73-140` against raw SQL. Each copy differs: `task.create` checks `canAssignTasks` and org ownership, `task.delete` checks neither; `chat.ts` treats any org member as authorized, `task.create` does not.

These mutations also `throw new Error("You don't have permission…")` rather than `TRPCError({ code: "FORBIDDEN" })`, so the client receives HTTP 500 with the message masked to "Internal server error" in production — users get no actionable error and monitoring sees authz denials as server faults.

**Fix:** one `assertProjectAccess(ctx, projectId, action)` in `src/server/api/authz.ts`, used by routers, agent tools, and (via a shared query) the WS server. Convert the bare `throw new Error` calls to `TRPCError`. **Effort:** M

---

### 18. Rate limiting is per-process in-memory

`src/server/rateLimit.ts:33` and `src/server/authRateLimit.ts:29` both hold state in a module-level `Map`. Both files document the limitation. With more than one app instance — or Next.js route handlers across separate lambdas — the effective limit multiplies by instance count, and every deploy resets it. The AI limiter is the only thing standing between a user and unbounded LLM spend (`AI_RATE_LIMIT` default 50/day, `rateLimit.ts:20`).

**Fix:** move both to Redis — `REDIS_NATIVE_URL` is already wired up for the WS pipeline (`src/server/redis/publisher.ts:10`). **Effort:** S

---

### 19. Notification queries are unbounded and polled

`notification.getAll` (`src/server/api/routers/notification.ts:9-17`) is `SELECT *` with no limit. `getUnreadCount` (`:19-31`) selects **every unread row** and returns `.length` instead of `COUNT(*)`. Both are polled every 15 s by `NotificationSystem` (`src/components/notifications/NotificationSystem.tsx:40`, `:46`) *in addition to* the `notification:new` socket event, and the socket handler then refetches both again (`:52-55`).

**Fix:** paginate `getAll`, use `count()` for the badge, and drop the polling interval to a long fallback (60 s+) now that WS delivery exists. **Effort:** S

---

### 20. `publishBroadcast` double-emits, and event updates go to every socket

`publishBroadcast` (`src/server/redis/publisher.ts:150-172`) publishes via Redis **and then unconditionally** POSTs to `WS_INTERNAL_URL/internal/emit`, so with Redis configured every broadcast is delivered twice. The WS server handles `__broadcast__` with `io.emit` (`ws-server/index.ts:60-62`) — a global fan-out to all connected clients, used by `emitEventDeleted` / `emitEventUpdated` (`src/server/socket/emit.ts:71-77`) regardless of who can see the event.

**Fix:** make the HTTP path a fallback (`if (!REDIS_NATIVE_URL)`), and scope event updates to an org or event room. **Effort:** S

---

### 21. No security headers

`config/next.config.js` defines no `headers()` — no CSP, HSTS, `X-Frame-Options`, or `Referrer-Policy`. The app renders user-authored content (note bodies, chat messages, event comments) and embeds third-party scripts (Google Maps, UploadThing), so a CSP is the main defence-in-depth left on the table.

**Fix:** add a `headers()` block with a nonce-based CSP, `frame-ancestors 'none'`, HSTS, and `Referrer-Policy: strict-origin-when-cross-origin`. **Effort:** M (CSP tuning against GSAP/Maps takes iteration)

---

### 22. Six unused dependencies, duplicate libraries, and two lockfiles

Verified absent from `src/`, `ws-server/`, `server.ts`: **`openai`** (LLM calls use raw `fetch` — `src/server/llm/llm/modelClient.ts:146`), **`bcrypt`**, **`bcryptjs`** (only `argon2` is used, in 4 files), **`@vercel/blob`** (UploadThing is the upload path), **`d3`**, **`motion`** (`framer-motion` is what's imported). `bcrypt` carries native bindings and `openai` is large — both slow installs and widen the supply-chain surface for nothing.

Both `package-lock.json` (384 KB) and `pnpm-lock.yaml` (302 KB) are committed, alongside both `.npmrc` and `.pnpmrc`, while `postinstall` hardcodes `npm run`. Installs are not reproducible — resolved versions depend on which package manager runs.

Also committed but shouldn't be: `build.log` (a truncated UTF-16 build transcript), `run_tsc.bat`.

**Fix:** `pnpm remove openai bcrypt bcryptjs @vercel/blob d3 motion`; delete `package-lock.json` and `.npmrc`, keep pnpm; delete `build.log` and add it to `.gitignore`. **Effort:** S

---

### 23. Three of five shipped locales are about half translated

Key counts: `en` 992, `bg` 997, but `de` / `es` / `fr` 478 each — roughly 52% of the UI missing for those three. `src/i18n/config.ts:5` declares all five as supported and the `LanguageSwitcher` offers them. Separately, `languageEnum` (`src/server/db/schemas/enums.ts:12`) lets a user persist `it`, `pt`, `ja`, `ko`, `zh`, `ar` — none of which have message files; `config.ts:14-19` catches the failed import and falls back to `en` messages while still returning the invalid `locale` string to next-intl.

**Fix:** either complete de/es/fr or drop them from `locales` until they're done; narrow `languageEnum` to the locales that exist; validate the `NEXT_LOCALE` cookie against `locales` before use. `tests/i18n/translations.test.ts` should assert key parity and fail. **Effort:** S (config) / L (translation work)

---

### 24. Password reset codes are not invalidated on reissue or success

`requestPasswordReset` inserts a new row each call (`src/server/api/routers/auth.ts:96-100`) without expiring prior codes, so up to 5 codes per 15-minute window are simultaneously valid. `resetPassword` marks only the code it consumed as used (`:212-215`), leaving the others valid for the remainder of their 15 minutes — including after the password has already been changed.

The rate limiter is also keyed on email alone (`createAuthRateLimitKey("reset_request", email)`), so an attacker can lock a specific user out of password recovery for 15 minutes at a time with 5 requests.

**Fix:** mark all outstanding codes for that email `used` when issuing a new one and when a reset succeeds; add a per-IP dimension to the limiter alongside the per-email one. **Effort:** S

---

### 25. Client components have grown past maintainable size

`ProjectIntelligenceChat.tsx` is 2,169 lines; `TaskTimelineClient.tsx` 1,873; `NotesDashboard.tsx` 1,387; `WorkspaceSettingsClient.tsx` 1,159; `EventFeed.tsx` 1,155; `CalendarClient.tsx` 1,053. On the server, `agentOrchestrator.ts` is 1,590 lines and `organization.ts` 1,535 (91 `ctx.db` calls in one file).

These ship to the browser as single chunks, can't be tested in pieces, and are where the concrete bugs in #11 live. Not a rewrite candidate — but each is a natural extract-hooks-and-subcomponents target, and `agentOrchestrator` splits cleanly along its existing A1/A2/A3/A4 seams (the profile and context-builder modules are already separated).

**Fix:** opportunistic extraction when touching them; prioritise `agentOrchestrator` since #1's fix lands there anyway. **Effort:** L

---

## P3

| # | Issue | Evidence | Fix |
|---|---|---|---|
| 26 | `rsvp_unique` is a plain index, not a constraint, despite the name — duplicate RSVPs are possible; `organization_members` has no unique `(organizationId, userId)` either, so the check-then-insert in `join` (`organization.ts:264-289`) and `acceptInvite` (`:1227-1234`) can race into duplicate memberships | `src/server/db/schemas/events.ts:61` uses `index("rsvp_unique")`; `organizations.ts:53-56` has only two plain indexes | Convert to `unique()` / `uniqueIndex()`; de-dupe first |
| 27 | The `jwt` callback's `trigger === "update"` branch writes client-supplied `email` and `name` into the token with no verification, so `useSession().update({ user: { email: … } })` spoofs session identity | `src/server/auth/config.ts:172-186` | Allow only `image` (and re-read `name`/`email` from the DB by `token.id`) |
| 28 | Org access codes are returned to every member including `guest` and `mentor`, so any member can hand out permanent org access; `join` has no rate limit on code guessing | `organization.ts:36-56` (`listMine` returns `accessCode`); `:239-255` (`join`, no limiter) | Restrict `accessCode` to admins; rate-limit `join` per user |
| 29 | PBKDF2 at 100k iterations with SHA-512 is below current OWASP guidance (210k) for note-content key derivation; the docblock also says "12-byte auth tag" where the code uses 16 | `src/server/encryption.ts:18` and `:11` | Raise iterations with a version marker on stored ciphertext; fix the comment |
| 30 | `listProjects` (A1 read tool) filters on `createdById` only, so the agent cannot see org projects the user is a member of but did not create — it under-reports for exactly the collaborative case it's meant to help with | `src/server/llm/tools/a1/readTools.ts:157` | Union owned + org-member + collaborator projects (reuse the helper from #17) |
| 31 | `proxy.ts` treats any path containing `.` as public and relies on cookie *presence* rather than validity | `src/proxy.ts:28`, `:41-43` | Documented tradeoff (Edge runtime can't call `auth()`); acceptable since `protectedProcedure` is the real gate — but tighten the `.` rule |
| 32 | 49 `console.*` calls in `src/server` log user IDs, org IDs and errors with no structured logger or redaction; `ws-server` logs every join/leave at info level | `grep -rc "console\." src/server` | Introduce a logger with levels and redaction before production traffic |

---

## Found while implementing week 1

### 33. (P1, fixed) Every WebSocket room authorization query referenced non-existent columns

`ws-server/rooms.ts` queries raw SQL with camelCase identifiers — `"organizationId"`, `"userId"`, `"projectId"` — but those columns are snake_case in the database. Postgres raises `column … does not exist`, the surrounding `catch` runs, and every catch block ends in `socket.disconnect(true)`.

The schema genuinely mixes conventions, which is how this went unnoticed: most columns are snake_case, but `projects.createdById` and `project_collaborators.collaboratorId` are declared in Drizzle without an explicit column name (`d.varchar({ length: 255 })`), so their real column names *are* camelCase. Verified against `meta/0019_snapshot.json`:

- `projects` → `createdById`, `organization_id`
- `project_collaborators` → `collaboratorId`, `project_id`
- `organization_members` → `user_id`, `organization_id`
- `direct_conversations` → `user_one_id`, `user_two_id`

**Impact.** `join:org` and `join:project` could never succeed — they threw and hard-disconnected the client. Since `useWebSocket` auto-joins the org room on connect and reconnects with `reconnectionAttempts: Infinity`, any user with an active organization would have been in a connect/disconnect loop. This is very likely why the client leans on `refetchInterval` polling (#11, #19) instead of the socket events that were built for it.

**Fixed** alongside #2: identifiers corrected, with a comment at the query recording the mixed-naming trap. Worth re-testing real-time org/project updates end to end — they have probably never worked.

### 34. (P2, not fixed) `next-auth` does not support the installed `next`

`npm install` fails outright: `next-auth@5.0.0-beta.25` declares `peer next@"^14.0.0-0 || ^15.0.0-0"`, and the project is on `next@16.1.1`. The pnpm setup hides this — `.npmrc`/`.pnpmrc` carry only hoist patterns, so pnpm is resolving it without complaint rather than by configuration.

Running a v5 beta against a major Next version it doesn't claim to support is a live risk for exactly the parts of the app that matter most here: cookie handling, route-handler behaviour, and the Edge/Node split. Combined with #22 (two lockfiles, `postinstall` hardcoding `npm`), the dependency tree is not reproducible.

**Fix:** upgrade `next-auth` to a release that lists Next 16 in its peer range, or pin Next to 15 until one exists. Either way, settle on one package manager so the conflict surfaces in CI instead of being absorbed silently.

### 35. (P2, fixed) `eslint-plugin-react-hooks` was never installed

Three components carried `// eslint-disable-next-line react-hooks/exhaustive-deps` — [A1ChatWidgetOverlay.tsx:149](../src/components/chat/A1ChatWidgetOverlay.tsx), [ProjectIntelligenceChat.tsx:1169](../src/components/projects/ProjectIntelligenceChat.tsx) and `:1185` — but the plugin was absent from `package.json` and unregistered in `eslint.config.js`. ESLint hard-errored on the unknown rule (3 of the 109 errors), and no hook rule had ever run on this codebase.

**Fixed:** plugin installed and registered explicitly in `config/eslint.config.js`. Registered by hand rather than via `reactHooks.configs.*` because as of v7 those presets are still eslintrc-shaped (`plugins` as an array), which flat config rejects. `rules-of-hooks` is an error (it catches conditionally-called hooks, a crash-class bug); `exhaustive-deps` is a warning.

It surfaced no `rules-of-hooks` violations but several dependency-array warnings worth a look — unnecessary deps in `MilestoneTimeline`/`themeColors`, unstable logical expressions feeding `useMemo` in `CalendarClient`/`NotesDashboard`/`ChatClient`, and a ref-in-cleanup warning in `NotificationSystem`.

To be precise about scope: `exhaustive-deps` would **not** have caught #11. It would have asked for `getOrCreate` in that dependency array, which is what causes the loop. The value here is `rules-of-hooks` plus removing three phantom errors.

A related unknown-rule error came from `jsx-a11y/alt-text` in `tests/setup.tsx`; that disable named a plugin this project doesn't install. Fixed by giving the `next/image` mock a default `alt` instead of suppressing anything.

### 36. (P1, fixed) All 42 test failures were one broken mock

[tests/setup.tsx](../tests/setup.tsx) mocked next-intl to echo the key back:

```ts
useTranslations: () => (key: string) => key,
```

So components rendered `signIn.noAccount` while the tests queried the English copy they were written against (`screen.getByText(/Don.t have an account/i)`). Every text-based query in those 6 files failed. The tests predate i18n and were never updated.

**Fixed:** the mock now resolves dotted keys against the real `src/i18n/messages/en.json`, with interpolation of `{placeholder}` values and a fallback to the bare key when a translation is missing. All 42 pass with no changes to the test files themselves. This also makes the suite fail if a translation key is deleted or renamed, which is the behaviour you want.

Only `useTranslations` and `useLocale` are imported from next-intl anywhere in `src/`, so the mock surface stayed small.

---

## Remediation plan

> **Status — week 1 implemented.** #1, #2, #3 (parts a and b), and #5 are fixed; a new
> shared helper `src/server/api/authz.ts` carries the project-access decision, covered
> by 15 behavioural tests in `tests/server/authz.test.ts`. Two things surfaced during
> the work and are recorded as #33 and #34 below. Still open from week 1: whether
> account switching should require re-authentication (#3c).
>
> **Status — `pnpm check` and `pnpm test` now pass.** Both were red before this work:
> lint reported 109 errors and 42 tests failed. `pnpm check` exits 0 (0 errors,
> 0 warnings) and `pnpm test` exits 0 (50 files, 955 tests). The 42 test failures were
> a single root cause, now fixed — see #36. #35 is fixed. Note that `pnpm check` runs
> `lint && tsc --noEmit`, so while lint was failing the typecheck never ran at all.

**Week 1 — close the cross-tenant holes.** These are the only findings where an ordinary authenticated user can reach another tenant's data today.

1. **#2 WS conversation authorization** (S) — smallest fix with the largest blast-radius reduction. One DB check in `ws-server/rooms.ts`.
2. **#1 Agent project authorization** (M) — build the shared `assertProjectAccess` helper here (it is also #17's deliverable) and wire it into the A1 tools, `taskPlannerDraft`, and `taskPlannerApply`; switch apply to `draft.projectId`.
3. **#3 Account-switch** (M) — clear the cookie on sign-out and authenticate the list endpoint immediately (both S); decide separately whether switching requires re-auth or the feature should go.
4. **#5 Invite privilege escalation** (S) — one input-schema change plus a caller-role check.

Write an integration test for each as you fix it — that bootstraps #13's harness on the cases that matter most.

**Week 2 — authentication integrity and quick wins.**

5. **#9 env validation** (S) — required secrets, no hardcoded DB fallback. Do this before anything reaches production.
6. **#8 Login rate limiting** (S) — reuse the existing limiter; add persistent lockout.
7. **#6 email uniqueness + scoped reset** (S code / M data) — the `.where(eq(users.id, …))` fix is a one-liner and should not wait for the migration.
8. **#11 ProjectChat loop and polling** (S) — likely the single biggest load reduction available.
9. **#10 Note encryption guard** (S) — stop the data loss; the PIN key-wrapping redesign can follow.
10. **#14 2FA** (S) — remove the misleading toggle now, implement later.
11. **#15 passwordHash leak**, **#19 notification queries**, **#22 dependency cleanup**, **#20 double-emit** (S each) — batch these into one housekeeping PR.

**Weeks 3–4 — structural.**

12. **#4 + #16 + #17: one authorization model** (L) — settle the role vocabulary, add `orgMemberProcedure` to `trpc.ts`, and convert every mutation to the shared helper. This is where the `mentor` role and the `canDeleteTasks` flag finally become real. Do it after week 1 so the shared helper already exists and is tested.
13. **#12 Migration baseline** (M) — regenerate from empty, prove it applies to a blank Postgres, drop the `postinstall` hook.
14. **#13 Real test harness** (L) — `createCallerFactory` + containerised Postgres; delete the source-grep tests as their real replacements land.
15. **#18 Redis rate limiting** (S), **#21 security headers** (M), **#24 reset-code invalidation** (S).

**Ongoing.** #23 translations, #25 component extraction (opportunistically, when touching those files), #26–#32.

**What I would not do.** Nothing here justifies a rewrite. The architecture — tRPC + Drizzle + a separated WS process + versioned agent drafts with confirmation tokens — is sound, and several parts are done carefully: the WS ticket HMAC uses `timingSafeEqual` with a length pre-check, access-code generation uses rejection sampling to avoid modulo bias, `chat.listMessages` and the agent apply paths bind to the caller correctly, the reset-PIN flow implements real lockout, and `noUncheckedIndexedAccess` is on. The problem is not the design; it is that authorization was written per-call-site instead of once, and that the test suite measures source text instead of behaviour. Fix those two things and the rest is maintenance.
