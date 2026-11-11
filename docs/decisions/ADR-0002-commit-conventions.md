# ADR-0002: Commit conventions

- Status: Accepted
- Date: 2026-11-09
- Decider: owner
- Source: Owner, in [`CLAUDE.md`](../../CLAUDE.md)

## Context

History mixed Conventional Commits with stray forms (`enhance:`, `feat:(ai)`, unprefixed messages).

## Decision

- `type(scope): subject`, with types `feat fix refactor perf test docs chore build ci style`; imperative, lower case, no period.
- The body says what changed and why, wrapped at about 72 columns.
- Scopes come from the list in `.claude/rules/git.md` (planned): `ai`, `auth`, `tasks`, `chat`, `notes`, `events`, `orgs`, `projects`, `i18n`, `settings`, `billing`, `ui`, `theme`, `landing`, `db`, `eval`, `thesis`, `harness`, `docs`.

## Consequences

- PR titles follow the same form and are checked by `pr-check`.
- The scope list is part of this decision: adding a scope means editing `git.md` in the same PR.

## Enforced by

`pr-check` for PR titles. Planned: `guard_bash.py` warns on commit messages (GIT-3).
