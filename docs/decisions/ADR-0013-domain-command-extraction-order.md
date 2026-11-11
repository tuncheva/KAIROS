# ADR-0013: Order of moving agent writes onto shared domain commands

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, answering [agent-harness-plan](../agents/plans/agent-harness-plan.md) §9

## Context

Agents re-implement router logic and have drifted from it (F-1, F-2, F-3, F-9, F-10). The fix is shared domain commands, which touches the largest routers.

## Options considered

Agent by agent; one large PR; router by router.

## Decision

- One agent per PR, in the order A6 → A5 → A4 → A3 → A2.
- Each PR extracts the commands that agent needs from its router, with the router's tests passing unchanged.

## Consequences

- Small reviewable PRs; the A5 and A3 security fixes land early.
- For a while some agents use commands and others raw SQL.

## Enforced by

Planned: `planGateway` accepts only manifest commands (APPLY-1).
