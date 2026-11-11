# ADR-0011: Budget ceilings for one agent run

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, answering [agent-harness-plan](../agents/plans/agent-harness-plan.md) §9

## Context

Today's worst case for one interactive turn is about 22 model calls (more with A3 note generation); a typical turn is 3–6.

## Options considered

16 calls / 150 s and 6 / 60 s; tighter 10 / 90 s and 4 / 45 s; looser 24 / 240 s and 8 / 90 s.

## Decision

- Interactive run: at most 16 model calls and 150 s; at most 8 tool calls per model turn; 10 s per tool.
- Scheduled run: at most 6 model calls and 60 s.
- Checked before each call; the run ends with a clear message when a ceiling is reached.

## Consequences

- Only the pathological tail is cut. Revisit after the bake-off measures real distributions.

## Enforced by

Planned: `run.budget` (BUDGET-2).
