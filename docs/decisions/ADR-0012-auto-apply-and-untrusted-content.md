# ADR-0012: Auto-apply after reading untrusted content

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, answering [agent-harness-plan](../agents/plans/agent-harness-plan.md) §9

## Context

Text a model reads can carry instructions. A small plan that auto-applies has no human between that text and the write (F-16).

## Options considered

Block on any content not written by the user; block only on public or fetched content; never block.

## Decision

- Auto-apply is disabled for a run that read other users' public events or any fetched document.
- Content written by teammates inside the user's own workspace (tasks, comments, notes) does not disable it.
- Memory writes after reading any content not written by the user still need an explicit confirm.

## Consequences

- Auto-apply keeps working for ordinary project questions.
- Workspace-internal injection is left to the small-plan limits and undo.

## Enforced by

Planned: `run.tainted` + `policy.decide` (TRUST-4, TRUST-5).
