# ADR-0001: Branching and releases

- Status: Accepted
- Date: 2026-11-09
- Decider: owner
- Source: Owner, in [`CLAUDE.md`](../../CLAUDE.md) (`5b7b3ac`) and the `make-pr` skill

## Context

CI runs on pushes to `development` and on PRs into `development` and `main`. Commits that reached `development` without a PR have no Documentation impact, so the thesis ledger cannot account for them.

## Decision

- Work goes on its own branch, `<type>/<short-name>`, created from `origin/development`.
- It reaches `development` only through a PR.
- `main` only receives `development`, through a release PR. A feature branch → `main` is refused.

## Consequences

- Every change that lands has a PR description, and therefore a Documentation impact entry.
- Local commits made on `development` by mistake are moved to a branch with the `make-pr` procedure.

## Enforced by

`pr-check` (hook and CI) refuses a feature branch → `main`. Planned: `guard_bash.py` blocks pushes to `main`/`development` and commits on `main` (GIT-1).
