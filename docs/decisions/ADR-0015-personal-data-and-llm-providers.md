# ADR-0015: Personal data sent to LLM providers

- Status: Accepted
- Date: 2026-11-03
- Decider: owner
- Source: Owner, answering [agent-harness-plan](../agents/plans/agent-harness-plan.md) §9

## Context

Prompts carry user and teammate data (F-36). The NVIDIA preset's terms forbid personal data and permit training on inputs (`providers.ts`), and it is the `.env.example` default.

## Options considered

Email: remove or keep. NVIDIA: development on test data only; development and evals on any database; drop entirely; keep everywhere.

## Decision

- The user's email is removed from A1's context and system prompt. A5 keeps member emails, which invites need.
- The NVIDIA preset is removed entirely. Every environment uses a provider whose terms allow personal data.

## Consequences

- `providers.ts`, `.env.example` and the provider tests change, and local `.env` files must switch provider.
- Eval runs after the switch are not comparable with the earlier `gpt-oss-20b` runs. The bake-off baseline on `gpt-oss-20b` (seeded data only) runs before the removal, as ordered in agent-harness-plan §11.2.

## Enforced by

Planned: unit tests on `resolveLlmConfig` and on A1's prompt (DATA-3).
