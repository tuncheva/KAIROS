# ADR-0004: Styling through theme tokens only

- Status: Proposed
- Date: 2026-11-11
- Decider: owner
- Source: Inferred from [`docs/theme.md`](../theme.md), `scripts/check-theme.ts` and `tests/styles/theme-guardrail.test.ts`

## Context

Tailwind v4 is configured only through `src/styles/globals.css`, with RGB-triple tokens and class-based dark mode. Raw colours drifted between screens before the guardrail existed.

## Decision

- Colours come from the tokens in `globals.css`; no raw hex on surfaces, no `slate`/`gray`, no Tailwind status colours (`check-theme` rules).
- An exception goes in `HEX_ALLOWED` with a reason.
- Dialogs use the shared `ui/Modal` shell and its dismiss control.

## Consequences

- `pnpm check:theme` and the theme guardrail test fail on a violation, locally and in CI.

## Enforced by

`pnpm check:theme`, `tests/styles/*` guardrail tests.
