# ADR-0009: How strict the Claude Code hooks are

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, in conversation while planning the dev harness

## Context

Hooks can block a tool call or only add a warning. Blocking everything (for example, refusing to end a turn until all checks pass) is safe but slow.

## Options considered

Block risky actions and warn on the rest; block everything; advisory only.

## Decision

- Hooks **block** actions that are risky or hard to undo: commits/pushes to protected branches, `--no-verify`, force-push, `db:push`/`db:migrate`, reading `.env`, broad `git add`, editing migration history.
- Everything else (formatting, naming, missing tests) is a **warning**, plus `/verify` before a PR.

## Consequences

- No blocking `Stop` hook; `make-pr` requires `/verify` instead.
- Guard hooks fail open with a warning if they crash, so a broken guard cannot stop all work (recommendation in the dev harness plan §5).

## Enforced by

Planned: `.claude/hooks/guard_*.py` (dev harness plan §5).
