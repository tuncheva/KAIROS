import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The columns and tables the events rebuild added, and the migrations that
 * carry them.
 *
 * Two things are worth pinning here beyond "the column exists":
 *
 * - Every new column is nullable. `region` is still the only location an event
 *   is required to have, so every row written before today stays valid and
 *   reads exactly as it did.
 * - The journal timestamps rise. `db:generate` stamps entries with `Date.now()`,
 *   which is *behind* this repo's hand-set values, and `drizzle-kit migrate`
 *   then skips the file silently — a migration that appears to apply and does
 *   nothing is the worst failure mode this repo has.
 */

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../", relative), "utf-8");

const eventsSchema = read("src/server/db/schemas/events.ts");
const enumsSchema = read("src/server/db/schemas/enums.ts");
const relations = read("src/server/db/schemas/relations.ts");
const journal = JSON.parse(
  read("src/server/db/migrations/meta/_journal.json"),
) as { entries: { idx: number; when: number; tag: string }[] };

const migrationsDir = path.resolve(__dirname, "../../src/server/db/migrations");

describe("events schema – what an event can finally say", () => {
  it("knows when it ends, which is what keeps a conference upcoming", () => {
    expect(eventsSchema).toContain('endsAt: d.timestamp("ends_at"');
  });

  it("knows where it is, beyond which of ten towns", () => {
    expect(eventsSchema).toContain('venue: d.varchar("venue"');
    expect(eventsSchema).toContain('address: d.varchar("address"');
  });

  it("can run out of room, and can be filed under a kind of thing", () => {
    expect(eventsSchema).toContain('capacity: d.integer("capacity")');
    expect(eventsSchema).toContain('topic: eventTopicEnum("topic")');
    expect(enumsSchema).toContain('pgEnum("event_topic"');
  });

  it("adds nothing that a row written yesterday would fail", () => {
    // Every one of them is nullable: no `.notNull()` on the new columns.
    for (const column of ["ends_at", "venue", "address", "capacity"]) {
      const line = eventsSchema
        .split("\n")
        .find((candidate) => candidate.includes(`"${column}"`));
      expect(line, `${column} should exist`).toBeTruthy();
      expect(line).not.toContain("notNull");
    }
  });

  it("records an edit without backdating the whole back catalogue", () => {
    // Nullable with no default and no backfill: defaulting it to `created_at`
    // would mark every event ever published as edited on migration day, which
    // is the sort of lie that teaches people to ignore the label.
    expect(eventsSchema).toContain('updatedAt: d.timestamp("updated_at"');
    expect(eventsSchema).not.toContain('updatedAt: d.timestamp("updated_at", { withTimezone: true }).notNull()');
    const migration = fs.readFileSync(
      path.join(migrationsDir, "0036_event_edited_at.sql"),
      "utf-8",
    );
    expect(migration).not.toContain("DEFAULT");
    expect(migration).not.toContain("UPDATE");
  });

  it("indexes the ordering discovery actually pages by", () => {
    // Discovery reads forward through time, not backwards through creation.
    expect(eventsSchema).toContain(
      'index("event_date_id_idx").on(t.eventDate, t.id)',
    );
  });
});

describe("events schema – the new tables", () => {
  it("co-hosts are a pair, so adding the same person twice is a no-op", () => {
    expect(eventsSchema).toContain("export const eventCoHosts");
    expect(eventsSchema).toContain(
      "primaryKey({ columns: [t.eventId, t.userId] })",
    );
  });

  it("saves are separate from RSVPs", () => {
    // People were using *Maybe* as a bookmark, which lands in the count the
    // host plans catering from.
    expect(eventsSchema).toContain("export const eventSaves");
  });

  it("both cascade with the event and the person", () => {
    const coHosts = eventsSchema.slice(
      eventsSchema.indexOf("export const eventCoHosts"),
      eventsSchema.indexOf("export const eventSaves"),
    );
    expect(coHosts.match(/onDelete: "cascade"/g)?.length).toBe(2);
  });

  it("stores the cover a host picked, and lets null mean 'you choose'", () => {
    expect(eventsSchema).toContain('coverTheme: eventCoverEnum("cover_theme")');
    expect(enumsSchema).toContain('pgEnum("event_cover"');
    // Nullable, because null is not "no colour" — it is "the view decides".
    expect(eventsSchema).not.toContain('eventCoverEnum("cover_theme").notNull()');
  });


  it("comments can be replied to, one level deep", () => {
    expect(eventsSchema).toContain('parentId: d.integer("parent_id")');
    expect(relations).toContain('relationName: "commentReplies"');
  });

  it("wires the new tables into relations", () => {
    expect(relations).toContain("eventCoHostsRelations");
    expect(relations).toContain("eventSavesRelations");
  });
});

describe("migrations", () => {
  const added = [
    "0032_event_place_and_replies",
    "0033_event_topic_capacity_cohosts",
    "0034_event_saves",
    "0035_event_cover_theme",
    "0036_event_edited_at",
  ];

  it("ships a file for every journal entry", () => {
    for (const tag of added) {
      expect(fs.existsSync(path.join(migrationsDir, `${tag}.sql`))).toBe(true);
      expect(journal.entries.some((entry) => entry.tag === tag)).toBe(true);
    }
  });

  it("keeps the journal timestamps rising, or migrate skips the file in silence", () => {
    const whens = journal.entries.map((entry) => entry.when);
    for (let i = 1; i < whens.length; i++) {
      expect(whens[i]!).toBeGreaterThan(whens[i - 1]!);
    }
  });

  it("keeps the journal indexes unique and ordered", () => {
    const indexes = journal.entries.map((entry) => entry.idx);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it("is re-runnable: every statement guards against already existing", () => {
    for (const tag of added) {
      const sql = fs.readFileSync(path.join(migrationsDir, `${tag}.sql`), "utf-8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement && !statement.startsWith("--"));

      for (const statement of statements) {
        const guarded =
          statement.includes("IF NOT EXISTS") ||
          statement.includes("WHEN duplicate_object THEN null");
        expect(guarded, `${tag}: ${statement.slice(0, 60)}`).toBe(true);
      }
    }
  });
});
