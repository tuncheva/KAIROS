# ADR-0014: When the rate-limit store is down

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, answering [agent-harness-plan](../agents/plans/agent-harness-plan.md) §9

## Context

The limiter is Redis-backed and currently fails open per process (F-29), so an outage removes all spending limits.

## Options considered

Fail closed with an env override; fail open; fail open with a low per-process cap.

## Decision

- AI requests are refused while the limiter cannot count them.
- `RATE_LIMIT_FAIL_OPEN=true` reopens them during an incident.
- The check and the record become one atomic operation.

## Consequences

- A Redis outage makes the assistant unavailable until it recovers or the override is set.

## Enforced by

Planned: `slidingWindow` (BUDGET-3).
