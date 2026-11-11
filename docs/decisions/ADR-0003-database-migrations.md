# ADR-0003: Database migrations

- Status: Proposed
- Date: 2026-11-11
- Decider: owner
- Source: Inferred from `scripts/fix-migration-journal.ts`, the CI `checks` job and `drizzle.config.ts`

## Context

drizzle `migrate` silently skips journal entries whose `when` is not monotonic, and early entries carry hand-set timestamps. The dev database is a shared remote instance.

## Decision

- Migrations are generated with `pnpm db:generate` only, which also runs the journal guard.
- An applied migration `.sql` and `meta/_journal.json` are never edited by hand.
- `pnpm db:push` is not used.
- `pnpm db:migrate` against a shared database is run by the owner, after the duplicate check for any new unique index.
- DDL uses `DATABASE_DIRECT_URL`, not the pooler.

## Consequences

- CI fails when the journal guard has to repair anything.
- Claude prepares migrations and hands the owner the command to apply them.

## Enforced by

CI `checks` (journal guard + `git diff --exit-code`). Planned: `guard_bash.py` blocks `db:push`/`db:migrate`; `guard_files.py` blocks journal and applied-migration edits.
