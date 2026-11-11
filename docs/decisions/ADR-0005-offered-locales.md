# ADR-0005: Offered locales

- Status: Proposed
- Date: 2026-11-11
- Decider: owner
- Source: Inferred from `src/i18n/locales.ts` and `tests/i18n/*`

## Context

Messages exist for `en`, `bg`, `de`, `es` and `fr`, but only `en` and `bg` are complete. The product's launch market writes in Bulgarian.

## Decision

- `en` and `bg` are offered and must both have every key.
- `de`, `es` and `fr` stay in `INCOMPLETE_LOCALES` and are not offered until the owner decides otherwise.
- Every UI string goes through i18n.

## Consequences

- A new key is written in Bulgarian, not copied from English.
- The i18n tests fail on a missing `en` or `bg` key.

## Enforced by

`tests/i18n/used-keys.test.ts`, `translations.test.ts`.
