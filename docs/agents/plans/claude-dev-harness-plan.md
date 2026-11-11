# Claude Code dev harness: plan and rules

Date: 2026-11-03 (rewritten 2026-11-11 against `development @ 9ea6e58`)
Status: proposal
Scope: `CLAUDE.md`, `.claude/**`, `docs/decisions/**`, `docs/_templates/**`, `.github/**`, `.gitignore`, `README.md`
Builds on: what already exists on `development`: [`CLAUDE.md`](../../../CLAUDE.md), the `make-pr` and `thesis-check` skills, `.claude/hooks/pr_check.py`, the PR template and the `thesis-harness/`.
Companion: [agent-harness-plan.md](agent-harness-plan.md), the runtime harness for the in-app agents. This plan is about how Claude Code works **on** KAIROS.
Decisions: [`docs/decisions/`](../../decisions/README.md). ADR-0008 (doc language) and ADR-0009 (hook strictness) were settled for this plan. ADR-0019 (where plans live) is open.

## 0. Why, and what changed since the first draft

Every Claude Code session in this repo should start with the same rules, owner decisions and runbooks, and behave the same way when it branches, writes docs, opens PRs and keeps CI green.

The first draft of this plan (2026-11-03) assumed none of that existed. Since then the owner built the PR half of it (`5b7b3ac`, `cf10a61`, `2b01fe4`, `fefcd6f`). This rewrite **extends what exists** rather than proposing a parallel set.

### 0.1 Already on `development`

| Piece | What it does |
|---|---|
| `CLAUDE.md` | Commit convention (types `feat fix refactor perf test docs chore build ci style`), branch flow (`origin/development` → own branch → PR → `development`; `main` only receives release PRs), the PR body, the **Documentation impact** section mapped to thesis section ids, and the checks |
| `.claude/settings.json` + `.claude/hooks/pr_check.py` | `PreToolUse` hook on the GitHub MCP PR tools and `gh pr create/edit`. Runs `thesis-harness pr-check` and **fails closed** |
| `.claude/skills/make-pr` | Branch and base rules, moving unpushed commits off `development`, mapping the diff to thesis sections, writing and checking the body, release PRs |
| `.claude/skills/thesis-check` + `.claude/agents/thesis-verifier` | Thesis review against the code and the official requirements (Bulgarian) |
| `.github/pull_request_template.md` | Summary · What changes · Tests · Documentation impact · Not verified · Left open |
| CI | 5 jobs (`checks`, `unit`, `integration`, `thesis-harness`, `build`), plus `pr-description.yml` (the same pr-check on every PR) and `doc-ledger.yml` (on demand) |

### 0.2 Still missing

| Gap | Consequence today |
|---|---|
| Owner decisions are not recorded anywhere a session loads | Six answered questions (2026-11-03) lived only in chat. **This PR adds `docs/decisions/`** with ADR-0001 to ADR-0019 |
| No guard against risky commands | Nothing stops a commit on `main`, `git push --force`, `--no-verify`, `pnpm db:push`, reading `.env`, or `git add -A` sweeping in unrelated edits |
| No rules for the code itself in `CLAUDE.md` | Authorization helpers, migrations, i18n, theme tokens, the agent harness rules: each session rediscovers them, or doesn't |
| No local mirror of CI | "Done" is claimed without running what CI runs. `CLAUDE.md` lists `pnpm check` and `pnpm test` but not integration, build or the thesis-harness tests |
| No doc rules beyond the PR body | Plans, audits and decisions land in inconsistent places and formats (ADR-0019) |
| `.gitignore` | `.claude/worktrees/` and `.kilo/` are not ignored |
| README drift | It lists A1–A5 only (no A6) and 2 of the 4 scheduled agents, says `pnpm db:push` in Getting started, and calls `pnpm check` "lint and typecheck" |

## 1. Architecture

Five layers. The first three are text Claude reads; the last two are executed by the harness, so they hold even when a session ignores the text.

| Layer | Where | Loaded | Status |
|---|---|---|---|
| Constitution | `CLAUDE.md` | Every session | Exists. Add the sections in §2 |
| Scoped rules | `.claude/rules/*.md` with `paths:` frontmatter | When Claude reads or edits matching files | New |
| Owner decisions | `docs/decisions/` (ADRs + `README.md` index) | Index imported into `CLAUDE.md`; an ADR in full when relevant | **Added by this PR**; import in Phase 1 |
| Runbooks | `.claude/skills/<name>/SKILL.md` | On `/name`, or when the request matches the description | `make-pr`, `thesis-check` exist. New ones in §4 |
| Enforcement | `.claude/hooks/*.py` registered in `.claude/settings.json`; CI workflows; tests | Always | `pr_check.py` exists. Guards in §5 |

Two design choices follow from what exists:

1. **Python for hooks.** `pr_check.py` and the thesis harness are Python (stdlib plus `thesis-harness/requirements.txt`), and `settings.json` already resolves `python3` or `python`. New hooks follow that pattern rather than adding Node `.mjs` scripts. The first draft's `check-pr-title.mjs` is dropped: `pr-check` already validates the title.
2. **`make-pr` stays the only PR runbook.** The first draft's `open-pr` and `release` skills are dropped; their extra steps (§4) go into `make-pr`.

Every rule has an id (`GIT-1`, `DOC-3`…). A hook, CI job or test that enforces a rule names the id when it fails.

```
CLAUDE.md                         + golden rules, rule/runbook index, @docs/decisions/README.md
.claude/
  settings.json                   + guard hooks and permissions, beside pr_check
  hooks/  pr_check.py (exists)    + guard_bash.py  guard_files.py  post_edit.py  session_start.py
          tests/test_guards.py    + stdlib unittest, run in CI
  rules/                          + git.md docs.md ci.md server.md llm-agents.md db-migrations.md i18n.md ui-theme.md tests.md
  skills/ make-pr (exists, extended)  thesis-check (exists)
                                  + verify  new-branch  write-doc  record-decision  db-migration  ci-triage  add-agent-capability  add-i18n-key
  agents/ thesis-verifier (exists) + reviewer.md
docs/decisions/                   ADR-0001 … ADR-0019, README.md, _template.md   (this PR)
docs/_templates/                  + plan.md  audit.md
```

## 2. `CLAUDE.md` additions

The current content stays as it is. Added, in this order:

1. **Golden rules** (ten lines, each linking to its rule file):
   1. Work on your own branch from `origin/development`. Never commit to `main`; never push to `main` or `development` (GIT-1).
   2. Accepted ADRs are binding; Proposed ones need the owner. Read the index before an architectural change (DEC-1).
   3. A bug fix starts with a failing test.
   4. Authorization goes through `src/server/api/authz.ts`; an LLM tool authorizes every row it returns (`llm-agents.md`).
   5. Migrations only via `pnpm db:generate`. Never `db:push`; `db:migrate` against a shared database only by the owner (ADR-0003).
   6. Never read or print `.env`; env lives in `src/env.js` (SEC-1).
   7. Every UI string through i18n, `en` and `bg` both (ADR-0005).
   8. Theme tokens only; `pnpm check:theme` passes (ADR-0004).
   9. Run `/verify` before saying work is done or opening a PR (CI-1).
   10. Stage by path. Never sweep someone else's uncommitted edits into a commit (GIT-5).
2. **Decisions:** `@docs/decisions/README.md`, so the index is in every session.
3. **Rules and runbooks:** a two-column index of `.claude/rules/*` and `.claude/skills/*`.
4. **Checks:** add `pnpm test:integration` (needs `.env` with `DATABASE_URL`), `pnpm build`, `python thesis-harness/tests/test_harness.py`, and `/verify` as the one command that picks the right set.

## 3. Rule catalog

### GIT: branches and commits (`.claude/rules/git.md`, ADR-0001, ADR-0002)

| Id | Rule | Enforced by |
|---|---|---|
| GIT-1 | No commit on `main`. No push to `main` or `development`. Commits on local `development` are allowed only to be moved off it with the `make-pr` procedure, so `guard_bash.py` **warns** on a commit there and **blocks** the push | `guard_bash.py` |
| GIT-2 | Branch `<type>/<kebab-slug>` from `origin/development`, using the commit types in `CLAUDE.md`. `claude/*` worktree branches are fine locally and renamed before the PR | `guard_bash.py` warns; `pr-check` refuses a feature branch → `main` |
| GIT-3 | Conventional Commits as in `CLAUDE.md`. Scope from the list in `git.md` (`ai`, `auth`, `tasks`, `chat`, `notes`, `events`, `orgs`, `projects`, `i18n`, `settings`, `billing`, `ui`, `theme`, `landing`, `db`, `eval`, `thesis`, `harness`, `docs`). `enhance:` and `feat:(ai)` are not valid | `guard_bash.py` warns |
| GIT-4 | Blocked: `--no-verify`, `push --force` (`--force-with-lease` on your own branch is allowed), `reset --hard`, `clean -f`, `branch -D` on `main`/`development` | `guard_bash.py` |
| GIT-5 | One concern per branch. Stage by path; `git add -A`, `git add .` and `git commit -a` are blocked. Files changed outside the session are named to the user, never committed | `guard_bash.py` |

### PR: pull requests (`make-pr`, the template, `pr-check`)

The existing rules in `CLAUDE.md` and `make-pr` stand: title, base, body sections, Documentation impact, the hook and the CI check. Added:

| Id | Rule | Enforced by |
|---|---|---|
| PR-1 | `/verify` passes before the PR is opened, and its table goes under `## Tests` | `make-pr` step |
| PR-2 | An optional `## Decisions and rules` section names the ADRs and rule ids (runtime `AUTH-*`, `APPLY-*`…; dev `GIT-*`…) the PR implements or touches. Required when a PR changes agent behaviour | `make-pr` step; `reviewer` agent |
| PR-3 | Over about 600 changed lines (excluding the lockfile and migration snapshots), propose a split before opening | `make-pr` step |
| PR-4 | A schema change says so under `## What changes`, with the duplicate-check SQL when it adds a unique index | `db-migration` runbook |
| PR-5 | Never enable auto-merge; never merge without the owner | `.claude/settings.json` asks for `gh pr merge` |

`pr-check` tolerates extra headings (`thesis-harness/thesis_harness/changes.py` checks only for `What changes` and `Documentation impact`), so PR-2 needs no change to the check.

### DOC: documentation (`.claude/rules/docs.md`, `write-doc`, ADR-0008, ADR-0019)

| Id | Rule |
|---|---|
| DOC-1 | Location by kind: decisions in `docs/decisions/`; plans and audits per ADR-0019; procedures Claude runs in `.claude/skills/`; thesis material in `docs/diploma/` and `thesis-harness/` |
| DOC-2 | Kebab-case filenames. Audits, research and eval reports carry `-YYYY-MM-DD` |
| DOC-3 | Header block: `Date / Status (proposal, accepted, in-progress, done, superseded) / Scope (paths) / Builds on (links)` |
| DOC-4 | English, except under `docs/diploma/` and the thesis harness prompts, which are Bulgarian (ADR-0008). Identifiers stay in English |
| DOC-5 | Code claims cite `path:line` and say what the paths are relative to. Re-verified claims carry ✔. A doc never states behaviour that was not read in the code |
| DOC-6 | A change and the docs it makes stale ship in the same PR: README, `CLAUDE.md`, the rule files. Thesis staleness goes in Documentation impact, as today |
| DOC-7 | A plan is not executed until the owner sets its status to `accepted` |

### DEC: owner decisions (`docs/decisions/`, `record-decision`)

| Id | Rule |
|---|---|
| DEC-1 | Accepted ADRs are binding. To deviate, propose a superseding ADR; never diverge silently |
| DEC-2 | Only the owner sets `Accepted`. An ADR Claude writes from the owner's own answer in chat is Accepted with that conversation as its source; one Claude proposes is `Proposed` |
| DEC-3 | A choice no ADR covers that would be costly to reverse (schema shape, dependency, auth model, product behaviour, provider) is asked, then recorded. Small reversible choices are made and stated |
| DEC-4 | Superseded ADRs are kept and marked, never deleted. The index lists every ADR with its status |

### CI: checks and tests (`.claude/rules/ci.md`, `tests.md`, `verify`, `ci-triage`)

| Id | Rule |
|---|---|
| CI-1 | `/verify` mirrors CI for what the diff touches. Always: `pnpm lint`, `pnpm typecheck`, `pnpm check:theme`, the journal check (`tsx scripts/fix-migration-journal.ts` then `git diff --exit-code -- src/server/db/migrations`), `pnpm test --retry=1`. When `src/server/**` or `tests/integration/**` changed and `.env` has `DATABASE_URL`: `pnpm test:integration`. When `src/app/**`, `next.config.ts` or `src/env.js` changed: `pnpm build`. When `thesis-harness/**` changed: `python thesis-harness/tests/test_harness.py`. When `.claude/hooks/**` changed: the hook tests. It reports each command's real result and what was skipped and why |
| CI-2 | Test placement: pure logic in `tests/{agents,server,lib,components}`; database or authorization in `tests/integration` (`createHarness`, `describeIntegration`); live model in `*.live.test.ts`, never in CI |
| CI-3 | A new invariant gets a guardrail test in the style of the existing ones (theme, i18n keys, router completeness, agent surface completeness), not a comment |
| CI-4 | No new `--retry`. A flaky test is fixed, or quarantined with the owner's agreement |
| CI-5 | A red job is never fixed by skipping or loosening its test without the owner (`ci-triage`) |
| CI-6 | Proposed CI additions, each a small PR: run `.claude/hooks/tests/` in the `thesis-harness` job (same Python setup); `pnpm format:check` in `checks` after a one-off format commit; the runtime-harness conformance tests (agent-harness-plan §8) in `unit` |

### Domain rules (scoped files)

| File | `paths:` | Content |
|---|---|---|
| `server.md` | `src/server/**`, `src/app/api/**` | `protectedProcedure` + zod input; `assertProjectAccess`, `assertProjectPermission`, `assertOrgPermission`; `import "server-only"`; the logger with ids, never content; env via `src/env.js`; no `console` (lint); drizzle where-guards (lint) |
| `llm-agents.md` | `src/server/llm/**`, `tests/agents/**` | The runtime rules by id (META, AUTH, CAP, HITL, APPLY, TRUST, MEM, BUDGET, AUTO, DATA, AUDIT) from agent-harness-plan §4; ADR-0006 and ADR-0010 to ADR-0015; "a new tool or operation is declared in the manifest" (`add-agent-capability`) |
| `db-migrations.md` | `src/server/db/**` | ADR-0003: `db:generate` only, never edit an applied migration or `meta/_journal.json`, the journal check, the duplicate check before a unique index, `DATABASE_DIRECT_URL` for DDL |
| `i18n.md` | `src/i18n/**`, `src/components/**`, `src/app/**` | ADR-0005; client code imports from `locales.ts`, not `config.ts`; the i18n guardrail tests |
| `ui-theme.md` | `src/components/**`, `src/app/**`, `src/styles/**` | ADR-0004; `docs/theme.md`; the dialog, mobile-shell and design-system guardrail tests |
| `tests.md` | `tests/**` | CI-2 to CI-4; the integration harness; `describeIntegration` skips without `DATABASE_URL` |

## 4. Runbooks (skills)

Each `SKILL.md` has `name` and a `description` with trigger phrases, then Preconditions, numbered Steps with exact commands, Stop and ask, Done when, and Rules.

| Skill | Status | Contents |
|---|---|---|
| `make-pr` | **extend** | Add before step 4: run `/verify` and paste its table under `## Tests` (PR-1); run the `reviewer` agent on the diff and fix or report what it flags by rule id; propose a split over ~600 lines (PR-3); add `## Decisions and rules` when relevant (PR-2) |
| `thesis-check` | keep | — |
| `verify` | new | CI-1. Output: a table of job, command, pass/fail, first failing line, plus skipped jobs with the reason. Never says "done" while a required job fails |
| `new-branch` | new | Check `git status`; name files changed outside the session and ask what to do with them; `git fetch origin development`; `git switch -c <type>/<slug> origin/development` |
| `write-doc` | new | Pick location and template (DOC-1, DOC-2, ADR-0019); header (DOC-3); open every cited file and mark ✔ (DOC-5); English or Bulgarian (DOC-4); link related docs both ways; status `proposal` |
| `record-decision` | new | Next number; `docs/decisions/_template.md`; status per DEC-2; add to the index; mark a superseded ADR. Also runs after the owner answers a DEC-3 question |
| `db-migration` | new | Edit `src/server/db/schemas/*`; `pnpm db:generate`; read the SQL; duplicate-check SQL for unique indexes; an integration test; `pnpm test:integration`. Stops before any `db:migrate` and gives the owner the command |
| `ci-triage` | new | `gh run list`, `gh run view <id> --log-failed`; map the job to its local command; reproduce; fix; `/verify`. Known causes: journal diff → timestamps out of order; `used-keys` → missing `bg` key; theme guardrail → raw hex or slate; build → env var missing in CI; PR description → Documentation impact format |
| `add-agent-capability` | new | Manifest entry (CAP-1); implementation that authorizes every returned row (AUTH-2); a deny test in `tests/integration`; update `toolAuthorization.test.ts` and `agentSurfaceCompleteness.test.ts`; i18n for any UI; `/verify` |
| `add-i18n-key` | new | Add to `en.json` and `bg.json` (Bulgarian written, not copied); use via `t("…")`; `pnpm test tests/i18n`. `de`, `es`, `fr` are incomplete locales and optional |

Subagent: `.claude/agents/reviewer.md`, read-only (`Read, Grep, Glob`). Given the diff, it reports violations of the rule catalog and Accepted ADRs, by id, with `path:line`. It never edits.

## 5. Enforcement: hooks and permissions

ADR-0009: block risky actions, warn on the rest. A block is the hook's `permissionDecision: "deny"` with the rule id and the fix, the same output shape `pr_check.py` uses. A warning is `additionalContext`.

| Event | Hook | Blocks | Warns |
|---|---|---|---|
| `SessionStart` | `session_start.py` | — | Branch; how far it is behind `origin/development`; files changed outside the session; the count of Proposed ADRs; "on `development` or `main`: start a branch first" |
| `PreToolUse` Bash | `guard_bash.py` | Commit on `main`; push to `main`/`development` (GIT-1); `--no-verify`, `push --force`, `reset --hard`, `clean -f` (GIT-4); `git add -A`, `git add .`, `commit -a` (GIT-5); `pnpm db:push`, `drizzle-kit push`, `pnpm db:migrate` (ADR-0003); `cat`/`type`/`Get-Content` on `.env*` other than `.env.example` (SEC-1) | Commit on `development` (GIT-1); branch name (GIT-2); commit message format (GIT-3) |
| `PreToolUse` Read, Edit, Write | `guard_files.py` | `.env*` other than `.env.example` (SEC-1); edits to `src/server/db/migrations/meta/_journal.json` or an existing migration `.sql` (ADR-0003) | — |
| `PostToolUse` Edit, Write | `post_edit.py` | — | Runs Prettier on the touched `ts/tsx/js/mdx` file. Reminders: schema touched → `/db-migration`; new `t("…")` key → `en` and `bg`; `src/server/llm/**` touched → the runtime rule ids |

**Failure mode.** `pr_check.py` fails closed, which is right for one PR call. A guard that runs on every Bash call must not brick the session if it crashes, so the guards **fail open with a visible warning** and are covered by tests instead. Their block lists are plain data at the top of each script.

**Matching the shells in use.** The owner works in PowerShell and Git Bash on Windows; CI is Linux. The guards parse the command text, not the shell, and the tests cover both spellings (`type .env`, `Get-Content .env`, `cat .env`).

**Permissions** in the committed `settings.json`:
- **Allow:** `pnpm lint|typecheck|test|check|check:theme|build`, `git status|diff|log|branch|switch|fetch|add <path>|commit`, `gh pr view|checks|create|edit`, `gh run list|view`, `python thesis-harness/run.py *`.
- **Ask:** `git push`, `gh pr merge`, `pnpm db:*`, `pnpm eval:live`, `pnpm test:integration`.
- **Deny:** `Read(.env)`, `Read(.env.*)` except `.env.example`.

Personal overrides stay in `settings.local.json`, which the owner's global gitignore already excludes.

**`.gitignore`:** add `.claude/worktrees/` and `.kilo/`.

## 6. Tests for the harness

- `.claude/hooks/tests/test_guards.py` (stdlib `unittest`): fixture `PreToolUse` JSON on stdin for every block and warn row in §5, both shells, and the fail-open path. Runs in the `thesis-harness` CI job.
- `tests/harness/claude-config.test.ts` (vitest, no DB):
  - every skill has `name` and `description` frontmatter;
  - every rule file's `paths:` globs match at least one file;
  - every link in `CLAUDE.md` and in the rule files resolves;
  - every hook in `settings.json` points to an existing script;
  - `docs/decisions/README.md` lists every ADR file, and each ADR's status matches the index.

## 7. Rollout (each a PR through `make-pr`)

0. **Decisions** (this PR): `docs/decisions/` with ADR-0001 to ADR-0019, plus this plan and the agent-harness-plan update.
1. **Constitution:** the `CLAUDE.md` additions (§2), `.gitignore`, the README fixes. Documentation impact: `readme`.
2. **Guards:** `guard_bash.py`, `guard_files.py`, `session_start.py`, the `settings.json` hooks and permissions, `test_guards.py`, the CI step.
3. **Runbooks:** `verify`, `new-branch`, `write-doc`, `record-decision`; the `make-pr` extensions; `reviewer`; `docs/_templates/`.
4. **Domain rules:** the six scoped rule files, `db-migration`, `ci-triage`, `add-agent-capability`, `add-i18n-key`, `post_edit.py`.
5. **Checks:** `claude-config.test.ts`; `format:check` after a format commit.

## 8. Verification

- **Fresh session:** the SessionStart summary appears. Asking "what are the rules for PRs?" returns `CLAUDE.md` plus the PR rules, and "which decisions are open?" lists the Proposed ADRs.
- **Guards**, on a scratch branch: `git commit` on `main` is blocked with GIT-1; `git push origin development` is blocked; `git add -A` is blocked with GIT-5; `type .env` and `Get-Content .env` are blocked with SEC-1; editing `_journal.json` is blocked; `pnpm db:push` is blocked.
- **`/verify`:** its job table matches the last CI run on the same commit (`gh run view`).
- **`make-pr` dry run** on a docs-only branch: the body passes `pr-check`, `## Tests` carries the `/verify` table, and no auto-merge is enabled.
- **CI:** `pnpm test` (with `tests/harness/`) and the hook tests pass.

## 9. Open

- **ADR-0019**, where plans live, decides DOC-1 for plans and audits.
- **Guards fail open** (§5) is a recommendation inside ADR-0009's "block risky" decision. If the owner prefers fail closed, the change is one constant per script.
