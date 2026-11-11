# ADR-0008: Documentation language

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, in conversation while planning the dev harness

## Context

Repository docs were mixed English and Bulgarian. The thesis is in Bulgarian.

## Options considered

English everywhere; Bulgarian everywhere; English with Bulgarian for thesis material.

## Decision

- Engineering docs (plans, audits, ADRs, runbooks, PR descriptions) are in English.
- Material under `docs/diploma/` and the thesis harness prompts are in Bulgarian.
- Code identifiers are always English.

## Consequences

- Existing Bulgarian engineering docs (`agent-system-fix-plan.md`) stay as they are; new ones are English.

## Enforced by

Planned: `.claude/rules/docs.md` (DOC-4).
