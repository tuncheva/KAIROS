# ADR-0007: Integration tests on real Postgres

- Status: Proposed
- Date: 2026-11-11
- Decider: owner
- Source: Inferred from `tests/integration/harness.ts` and the CI `integration` job

## Context

Authorization and apply bugs in this codebase live in SQL filters and multi-statement writes, which mocks do not exercise.

## Decision

- Database and authorization behaviour is tested against real Postgres (pgvector) in a throwaway schema per run, through `createHarness` and `describeIntegration`.
- Such tests are not mocked.

## Consequences

- Integration tests skip without `DATABASE_URL` locally and always run in CI.
- They are safe against a database that holds real data, because the schema is dropped on teardown.

## Enforced by

CI `integration` job.
