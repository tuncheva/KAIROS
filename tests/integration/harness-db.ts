/**
 * The scratch-schema client the global `db` mock delegates to (see `setup.ts`).
 *
 * A module of its own rather than part of `harness.ts`, because the mock factory
 * must not import `harness.ts` — that pulls in `appRouter`, and with it the very
 * `~/server/db` module being mocked.
 */

let current: object | null = null;

export function setHarnessDb(db: object | null): void {
  current = db;
}

export function currentHarnessDb(): object {
  if (!current) {
    throw new Error(
      "Global `db` used outside a harness: call createHarness() in beforeAll first.",
    );
  }
  return current;
}
