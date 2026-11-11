# ADR-0006: Agents draft, the user confirms

- Status: Proposed
- Date: 2026-11-11
- Decider: owner
- Source: Inferred from the orchestrator and `orchestrator/autoApply.ts`; see [agent-harness-plan](../agents/plans/agent-harness-plan.md)

## Context

The write agents (A2–A6) change data other people see. Applying a model's plan without review has caused wrong and duplicated changes in evals.

## Decision

- Every agent write goes draft → confirm → apply, with a confirmation token bound to user, draft and plan hash.
- The only exception is a small plan (at most 3 changes, no deletes, nobody else assigned, no open question) that the user opted into, the workspace allows, and that can be undone.
- Destructive and external operations (delete, remove member, archive, email invite, public event, calendar) are never auto-applied.

## Consequences

- Auto-apply is further limited by ADR-0012.
- A1's four self-effect tools (memory, reminders) are the documented exception and get a visible receipt (agent-harness-plan CAP-5).

## Enforced by

`agents/smallPlans.ts`, `autoApply.ts`; planned: `policy.decide` (HITL-1, HITL-3).
