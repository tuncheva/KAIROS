/**
 * Integration harness: real tRPC procedures against a real Postgres.
 *
 * ## Why this exists
 *
 * Audit finding #13: 23 of 49 test files read a source file and asserted
 * `toContain("someString")`, and **zero** tests executed a tRPC procedure. The
 * suite was green while four cross-tenant authorization holes were live in the
 * code — several of those tests were even named as if they covered those areas. A
 * test that greps for `permission, "write"` cannot detect a missing check.
 *
 * ## How it isolates
 *
 * Each run creates a throwaway schema on the configured database, applies the
 * migrations into it with every `"public".` reference rewritten to the scratch
 * schema, and points the connection's `search_path` at it. Nothing in `public` is
 * read or written, so this is safe to run against the same instance that holds real
 * data — which is what makes it usable without Docker or a separate service.
 *
 * The schema name includes the process id so parallel vitest workers cannot
 * collide, and it is dropped in teardown even when a test throws.
 *
 * ## Skipping
 *
 * `describeIntegration` becomes `describe.skip` when `DATABASE_URL` is absent, so
 * a checkout with no database still runs the rest of the suite green rather than
 * erroring. That is a deliberate trade-off: CI without a database silently covers
 * less. `pnpm test:integration` exists to run these explicitly.
 */

import fs from "node:fs";
import path from "node:path";
import { describe } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "~/server/db/schema";
import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import type { TRPCContext } from "~/server/api/trpc";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/server/db/migrations");

export const INTEGRATION_DB_URL = process.env.DATABASE_URL;
export const hasDatabase = Boolean(INTEGRATION_DB_URL);

/**
 * `describe` that skips itself without a database, so these files are safe to
 * leave in the default suite.
 */
export const describeIntegration = hasDatabase ? describe : describe.skip;

export interface Harness {
  db: TRPCContext["db"];
  /** Build a caller as a given user, or anonymously when `userId` is null. */
  caller: (userId: string | null) => ReturnType<typeof createCaller>;
  cleanup: () => Promise<void>;
}

const createCaller = createCallerFactory(appRouter);

/** Session-mode connection: the pooler's transaction mode cannot hold a search_path. */
function sessionUrl(url: string): string {
  return url.replace(":6543/", ":5432/").replace("?pgbouncer=true", "");
}

function migrationStatements(scratch: string): { tag: string; statements: string[] }[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };

  return journal.entries.map((entry) => {
    const sql = fs
      .readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8")
      // Enum types and foreign keys are emitted schema-qualified. Rewriting them
      // is what keeps the run inside the scratch schema instead of reaching into
      // `public` — which on a live database would be destructive.
      .replaceAll('"public".', `"${scratch}".`);

    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s && !s.split("\n").every((line) => line.trim().startsWith("--")));

    return { tag: entry.tag, statements };
  });
}

/**
 * Provision an isolated schema and return a caller factory bound to it.
 *
 * Call in `beforeAll`, and `cleanup()` in `afterAll`.
 */
export async function createHarness(label: string): Promise<Harness> {
  if (!INTEGRATION_DB_URL) {
    throw new Error("createHarness called without DATABASE_URL");
  }

  const scratch = `kairos_test_${label}_${process.pid}`;
  const sql = postgres(sessionUrl(INTEGRATION_DB_URL), {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });

  await sql.unsafe(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`);
  await sql.unsafe(`CREATE SCHEMA "${scratch}"`);

  for (const { statements } of migrationStatements(scratch)) {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO "${scratch}"`);
      for (const statement of statements) await tx.unsafe(statement);
    });
  }

  // A second connection whose search_path is pinned for every query, so the
  // application's unqualified table names resolve inside the scratch schema.
  const appSql = postgres(sessionUrl(INTEGRATION_DB_URL), {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
    connection: { search_path: `"${scratch}"` },
  });

  const db = drizzle(appSql, { schema }) as unknown as TRPCContext["db"];

  return {
    db,
    caller: (userId: string | null) =>
      createCaller({
        db,
        session: userId
          ? { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" }
          : null,
        headers: new Headers(),
      } as unknown as TRPCContext),
    cleanup: async () => {
      await appSql.end({ timeout: 5 });
      try {
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`);
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;
const uniq = () => `${process.pid}-${seq++}`;

export async function makeUser(
  db: TRPCContext["db"],
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<{ id: string; email: string }> {
  const id = `user-${uniq()}`;
  const email = `${id}@example.test`;

  const [row] = await db
    .insert(schema.users)
    .values({
      id,
      email,
      name: id,
      // Verified, because these fixtures stand in for established accounts rather
      // than exercising the signup flow.
      emailVerified: new Date(),
      ...overrides,
    })
    .returning({ id: schema.users.id, email: schema.users.email });

  return row!;
}

export async function makeOrganization(
  db: TRPCContext["db"],
  ownerId: string,
): Promise<{ id: number; accessCode: string }> {
  const accessCode = `T${uniq()}`.slice(0, 14).toUpperCase();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `Org ${uniq()}`, accessCode, createdById: ownerId })
    .returning({ id: schema.organizations.id, accessCode: schema.organizations.accessCode });

  return org!;
}

export async function addMember(
  db: TRPCContext["db"],
  organizationId: number,
  userId: string,
  role: "admin" | "member" | "guest" | "worker" | "mentor",
  flags: Partial<typeof schema.organizationMembers.$inferInsert> = {},
): Promise<void> {
  const { flagsForRole } = await import("~/lib/permissions");
  await db.insert(schema.organizationMembers).values({
    organizationId,
    userId,
    role,
    ...flagsForRole(role),
    ...flags,
  });
}

export async function makeProject(
  db: TRPCContext["db"],
  createdById: string,
  organizationId: number | null,
): Promise<{ id: number }> {
  const [project] = await db
    .insert(schema.projects)
    .values({
      title: `Project ${uniq()}`,
      description: "",
      createdById,
      organizationId,
      shareStatus: "private",
    })
    .returning({ id: schema.projects.id });

  return project!;
}

export async function makeTask(
  db: TRPCContext["db"],
  projectId: number,
  createdById: string,
): Promise<{ id: number }> {
  const [task] = await db
    .insert(schema.tasks)
    .values({
      title: `Task ${uniq()}`,
      description: "",
      projectId,
      createdById,
      priority: "medium",
      status: "pending",
    })
    .returning({ id: schema.tasks.id });

  return task!;
}
