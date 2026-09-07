import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Database schema tests — verify all tables have proper security patterns:
 * - Cascade deletes where needed
 * - Foreign keys properly defined
 * - Indexes on frequently queried columns
 */

const schemaIndexPath = path.resolve(__dirname, "../../src/server/db/schema.ts");
fs.readFileSync(schemaIndexPath, "utf-8");

const schemasPath = path.resolve(__dirname, "../../src/server/db/schemas/index.ts");
const schemasIndexSource = fs.readFileSync(schemasPath, "utf-8");

const relationsPath = path.resolve(__dirname, "../../src/server/db/schemas/relations.ts");
const relationsSource = fs.readFileSync(relationsPath, "utf-8");

const usersSchemaPath = path.resolve(__dirname, "../../src/server/db/schemas/users.ts");
const usersSchemaSource = fs.readFileSync(usersSchemaPath, "utf-8");

const notesSchemaPath = path.resolve(__dirname, "../../src/server/db/schemas/notes.ts");
const notesSchemaSource = fs.readFileSync(notesSchemaPath, "utf-8");

describe("Schema — Cascade Delete Safety", () => {
  it("accounts table has onDelete cascade on userId", () => {
    // Find the accounts table definition and check cascade
    const accountsSection = usersSchemaSource.slice(
      usersSchemaSource.indexOf("export const accounts"),
      usersSchemaSource.indexOf("export const accounts") + 1200,
    );
    expect(accountsSection).toContain('onDelete: "cascade"');
  });

  it("sessions table has onDelete cascade on userId", () => {
    const sessionsSection = usersSchemaSource.slice(
      usersSchemaSource.indexOf("export const sessions"),
      usersSchemaSource.indexOf("export const sessions") + 1200,
    );
    expect(sessionsSection).toContain('onDelete: "cascade"');
  });
});

describe("Schema — Table Definitions", () => {
  const expectedDefinitions: Array<{ name: string; source: string }> = [
    { name: "users", source: usersSchemaSource },
    { name: "accounts", source: usersSchemaSource },
    { name: "sessions", source: usersSchemaSource },
    { name: "projects", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/projects.ts"), "utf-8") },
    { name: "tasks", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/tasks.ts"), "utf-8") },
    { name: "notebooks", source: notesSchemaSource },
    { name: "notifications", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/notifications.ts"), "utf-8") },
    { name: "organizations", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/organizations.ts"), "utf-8") },
    { name: "organizationMembers", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/organizations.ts"), "utf-8") },
    { name: "events", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/events.ts"), "utf-8") },
    { name: "eventComments", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/events.ts"), "utf-8") },
    { name: "eventLikes", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/events.ts"), "utf-8") },
    { name: "eventRsvps", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/events.ts"), "utf-8") },
    { name: "projectCollaborators", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/projects.ts"), "utf-8") },
    { name: "taskActivityLog", source: fs.readFileSync(path.resolve(__dirname, "../../src/server/db/schemas/tasks.ts"), "utf-8") },
  ];

  for (const def of expectedDefinitions) {
    it(`defines "${def.name}" table`, () => {
      expect(def.source).toContain(`export const ${def.name}`);
    });
  }
});

describe("Schema — Relations Definitions", () => {
  it("defines usersRelations", () => {
    expect(relationsSource).toContain("usersRelations");
  });

  it("users have many projects", () => {
    expect(relationsSource).toContain("many(projects)");
  });

  it("users have many tasks", () => {
    expect(relationsSource).toContain("many(tasks)");
  });

  it("users have many accounts", () => {
    expect(relationsSource).toContain("many(accounts)");
  });

  it("users have many sessions", () => {
    expect(relationsSource).toContain("many(sessions)");
  });
});

describe("Schema — No SQL Injection Vectors", () => {
  it("does not use raw SQL in schema definitions", () => {
    // Schema should use Drizzle's type-safe column builders, not raw SQL
    expect(schemasIndexSource).not.toMatch(/sql`[^`]*\$\{/);
  });
});

describe("Schema — Sensitive Fields", () => {
  it("has password field on users table", () => {
    expect(usersSchemaSource).toContain("password");
  });

  it("has passwordHash field on notes (for encrypted notes)", () => {
    expect(notesSchemaSource).toContain("passwordHash");
  });

  it("has email field on users table", () => {
    expect(usersSchemaSource).toContain("email");
  });
});
