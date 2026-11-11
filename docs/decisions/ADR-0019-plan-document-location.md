# ADR-0019: Where plans and analyses live

- Status: Proposed
- Date: 2026-11-11
- Decider: owner
- Source: [claude-dev-harness-plan](../agents/plans/claude-dev-harness-plan.md) DOC-1

## Context

Plans live both in `docs/agents/plans/` without a date in the name (`agent-harness-plan.md`) and in `docs/agents/` with one (`harness-plan-2026-11-09.md`).

## Options considered

(a) Living plans in `docs/<area>/plans/`, undated, date in the header; dated analyses and audits in `docs/<area>/`. (b) Everything dated, in `docs/<area>/`. (c) Everything in `plans/`, dated.

## Decision

_Pending._ Recommendation: (a). A plan is edited as it progresses, so a date in its name goes stale; an audit is a snapshot, so its date belongs in the name.

## Consequences

_Pending._

## Enforced by

Planned: `.claude/rules/docs.md` (DOC-1, DOC-2).
