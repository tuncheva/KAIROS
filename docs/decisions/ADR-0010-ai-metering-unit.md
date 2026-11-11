# ADR-0010: What one AI request is

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, answering [agent-harness-plan](../agents/plans/agent-harness-plan.md) §9

## Context

One chat turn can make many model calls, but only the first was counted (F-27). Plans are sold as "AI requests per day".

## Options considered

Count model calls; count tokens; calls plus a per-turn token cap.

## Decision

- Every model call counts as one request against the user's daily window: A1 hops, sub-agent drafts, JSON repairs, truncation retries, titles, summaries and per-operation generation.
- Scheduled runs keep their own system window.
- Token usage is recorded per call so a switch to token metering can be decided on data later.

## Consequences

- The daily limits on the pricing page now buy fewer turns than before for multi-agent requests; the plan limits may need revisiting once real numbers exist.

## Enforced by

Planned: `modelGateway` (BUDGET-1), `agent_runs` totals (AUDIT-1).
