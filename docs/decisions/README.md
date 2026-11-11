# Decisions

Binding decisions about how KAIROS is built, one file per decision (ADR). Every Claude Code session reads this index; see [claude-dev-harness-plan](../agents/plans/claude-dev-harness-plan.md) §3 (DEC).

## How decisions work

- **Accepted** decisions are binding. To change one, write a new ADR that supersedes it; the old one is marked `Superseded by ADR-NNNN` and kept.
- **Proposed** decisions are not acted on. Work that depends on one stops and asks the owner.
- Only the owner sets `Accepted`. An ADR written from the owner's own answer is Accepted with that answer as its source; anything else starts as Proposed.
- A costly-to-reverse choice that no ADR covers is asked first, then recorded here (`record-decision`).
- New ADRs copy [`_template.md`](_template.md) and take the next number.

## Index

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0001](ADR-0001-branching-and-releases.md) | Branching and releases | Accepted | 2026-11-09 |
| [0002](ADR-0002-commit-conventions.md) | Commit conventions | Accepted | 2026-11-09 |
| [0003](ADR-0003-database-migrations.md) | Database migrations | Proposed | 2026-11-11 |
| [0004](ADR-0004-styling-tokens.md) | Styling through theme tokens only | Proposed | 2026-11-11 |
| [0005](ADR-0005-offered-locales.md) | Offered locales | Proposed | 2026-11-11 |
| [0006](ADR-0006-agent-write-confirmation.md) | Agents draft, the user confirms | Proposed | 2026-11-11 |
| [0007](ADR-0007-integration-test-database.md) | Integration tests on real Postgres | Proposed | 2026-11-11 |
| [0008](ADR-0008-documentation-language.md) | Documentation language | Accepted | 2026-11-03 |
| [0009](ADR-0009-claude-hook-strictness.md) | How strict the Claude Code hooks are | Accepted | 2026-11-03 |
| [0010](ADR-0010-ai-metering-unit.md) | What one AI request is | Accepted | 2026-11-03 |
| [0011](ADR-0011-agent-run-budgets.md) | Budget ceilings for one agent run | Accepted | 2026-11-03 |
| [0012](ADR-0012-auto-apply-and-untrusted-content.md) | Auto-apply after reading untrusted content | Accepted | 2026-11-03 |
| [0013](ADR-0013-domain-command-extraction-order.md) | Order of moving agent writes onto shared domain commands | Accepted | 2026-11-03 |
| [0014](ADR-0014-rate-limiter-outage.md) | When the rate-limit store is down | Accepted | 2026-11-03 |
| [0015](ADR-0015-personal-data-and-llm-providers.md) | Personal data sent to LLM providers | Accepted | 2026-11-03 |
| [0016](ADR-0016-model-evaluation-budget.md) | API budget and account for the model bake-off and demo | Proposed | 2026-11-11 |
| [0017](ADR-0017-dependent-handoffs-scope.md) | Dependent handoffs before the defense | Proposed | 2026-11-11 |
| [0018](ADR-0018-membership-undo.md) | Undo for membership changes | Proposed | 2026-11-11 |
| [0019](ADR-0019-plan-document-location.md) | Where plans and analyses live | Proposed | 2026-11-11 |
