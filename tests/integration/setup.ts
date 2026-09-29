/**
 * Point the application's global `db` at the harness's scratch schema.
 *
 * Procedures get `ctx.db`, which the harness binds to the scratch schema — but a
 * number of server modules import `db` from `~/server/db` directly (billing seats
 * and entitlements, the AI runner, reminders). Unmocked, that client connects to
 * `DATABASE_URL` with the default `search_path`, so those paths read and wrote the
 * real `public` schema: against the hosted database they touched live data, and
 * against an empty CI database they fail with `relation "organizations" does not
 * exist`.
 *
 * Registered here, in a setup file, so the mock applies to every test file's module
 * graph without each file having to remember it. The proxy resolves the target on
 * every access because `createHarness` runs in `beforeAll`, after imports.
 */

import { vi } from "vitest";

// `vi.mock` is hoisted above imports, so the factory loads its dependency itself.
vi.mock("~/server/db", async () => {
  const { currentHarnessDb } = await import("./harness-db");
  const { PgDatabase } = await import("drizzle-orm/pg-core");
  return {
    // The target carries PgDatabase's prototype so `is(db, PgDatabase)` checks —
    // the Auth.js Drizzle adapter runs one at import time — still recognise it.
    db: new Proxy(
      Object.create(PgDatabase.prototype) as object,
      {
        get(_target, prop) {
          const db = currentHarnessDb();
          const value: unknown = Reflect.get(db, prop);
          return typeof value === "function"
            ? (value as (...a: unknown[]) => unknown).bind(db)
            : value;
        },
      },
    ),
  };
});
