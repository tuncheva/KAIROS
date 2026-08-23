/**
 * Export formatting: the escaping rules, which is where exporters break.
 *
 * Every assertion here is about hostile or awkward content rather than about the
 * happy path. That is deliberate — a task title is arbitrary user text, and the
 * file it lands in gets opened by a spreadsheet, a calendar client, or a
 * colleague. The three failure modes worth defending against:
 *
 * 1. **CSV injection.** A title beginning `=` is a live formula in Excel and
 *    Sheets. This is a real vulnerability class, not a formatting nicety.
 * 2. **Structural escaping.** An unescaped comma, quote or newline shifts every
 *    later column, silently, in a file nobody re-reads before sending on.
 * 3. **ICS line length.** RFC 5545 counts octets, and this product runs in
 *    Bulgarian, where Cyrillic is two bytes a character. A character-counted
 *    fold produces lines up to twice the legal length.
 *
 * And one privacy rule: a locked note's content must not leave through here.
 */

import { describe, expect, it } from "vitest";

import {
  toCsv,
  toIcs,
  toMarkdown,
  type ExportBundle,
  type ExportTask,
} from "~/server/export/formatters";

function task(overrides: Partial<ExportTask> = {}): ExportTask {
  return {
    id: 1,
    title: "Ship the invoice export",
    status: "pending",
    priority: "medium",
    dueDate: new Date("2026-09-01T10:00:00Z"),
    completedAt: null,
    createdAt: new Date("2026-08-01T09:00:00Z"),
    projectTitle: "Delta",
    assignee: "Mira",
    ...overrides,
  };
}

function bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    tasks: [],
    notes: [],
    events: [],
    exportedAt: new Date("2026-08-23T12:00:00Z"),
    userName: "Mira",
    ...overrides,
  };
}

describe("toCsv — injection", () => {
  it("neutralises a title that would evaluate as a formula", () => {
    const out = toCsv([task({ title: '=HYPERLINK("http://evil","click")' })]);

    // Prefixed with an apostrophe so the cell is read as text. The quoting is
    // incidental here; the leading `'` is the defence.
    expect(out).toContain("'=HYPERLINK");
  });

  it("neutralises every formula lead character", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      const out = toCsv([task({ title: `${lead}cmd` })]);
      expect(out, lead).toContain(`'${lead}cmd`);
    }
  });

  it("leaves ordinary titles unprefixed", () => {
    // Over-escaping is its own bug: every title gaining a stray apostrophe would
    // make the export visibly wrong to anyone who opened it.
    const out = toCsv([task({ title: "Ship it" })]);
    expect(out).toContain("Ship it");
    expect(out).not.toContain("'Ship it");
  });
});

describe("toCsv — structure", () => {
  it("quotes and doubles embedded quotes", () => {
    const out = toCsv([task({ title: 'He said "no"' })]);
    expect(out).toContain('"He said ""no"""');
  });

  it("quotes a value containing the delimiter", () => {
    const out = toCsv([task({ title: "Design, build, ship" })]);
    expect(out).toContain('"Design, build, ship"');
  });

  it("quotes a value containing a newline, keeping the row intact", () => {
    const out = toCsv([task({ title: "Line one\nLine two" })]);

    expect(out).toContain('"Line one\nLine two"');
    // Header + one record, terminated. The embedded newline must not create a
    // third record.
    expect(out.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("emits a header even with no rows", () => {
    // An empty file reads as a failed export rather than an empty workspace.
    const out = toCsv([]);
    expect(out.startsWith("id,title,project")).toBe(true);
  });

  it("renders a missing date as empty rather than as a word", () => {
    const out = toCsv([task({ dueDate: null, completedAt: null })]);
    expect(out).not.toMatch(/null|undefined|Invalid/);
  });
});

describe("toMarkdown", () => {
  it("lists a locked note but withholds its content", () => {
    const out = toMarkdown(
      bundle({
        notes: [
          {
            id: 1,
            title: "Bank details",
            content: null,
            locked: true,
            createdAt: new Date("2026-08-01T00:00:00Z"),
          },
        ],
      }),
    );

    // Both halves matter: silently dropping the note would hide that something
    // was skipped, and including the body would make the note lock decorative.
    expect(out).toContain("Bank details");
    expect(out).toMatch(/locked/i);
  });

  it("includes the content of an unlocked note", () => {
    const out = toMarkdown(
      bundle({
        notes: [
          {
            id: 1,
            title: "Retro",
            content: "We shipped the export.",
            locked: false,
            createdAt: new Date("2026-08-01T00:00:00Z"),
          },
        ],
      }),
    );

    expect(out).toContain("We shipped the export.");
  });

  it("marks completed tasks as checked", () => {
    const out = toMarkdown(bundle({ tasks: [task({ status: "completed" })] }));
    expect(out).toContain("- [x]");
  });

  it("says None rather than leaving a section blank", () => {
    const out = toMarkdown(bundle());
    expect(out).toContain("Tasks (0)");
    expect(out).toContain("_None._");
  });
});

describe("toIcs — escaping", () => {
  it("escapes commas, semicolons and backslashes in a summary", () => {
    const out = toIcs(
      bundle({
        events: [
          {
            id: 1,
            title: "Review; plan, and C:\\ship",
            description: "",
            eventDate: new Date("2026-09-01T10:00:00Z"),
          },
        ],
      }),
    );

    expect(out).toContain("Review\\; plan\\, and C:\\\\ship");
  });

  it("escapes backslashes before the escapes it introduces", () => {
    // Order dependency: escaping the comma first and the backslash second would
    // turn `\,` into `\\,` and corrupt the value.
    const out = toIcs(
      bundle({
        events: [
          {
            id: 1,
            title: "a\\,b",
            description: "",
            eventDate: new Date("2026-09-01T10:00:00Z"),
          },
        ],
      }),
    );

    expect(out).toContain("a\\\\\\,b");
  });

  it("turns a newline into the literal escape, never a raw break", () => {
    const out = toIcs(
      bundle({
        events: [
          {
            id: 1,
            title: "one\ntwo",
            description: "",
            eventDate: new Date("2026-09-01T10:00:00Z"),
          },
        ],
      }),
    );

    expect(out).toContain("SUMMARY:one\\ntwo");
  });
});

describe("toIcs — structure", () => {
  it("uses CRLF throughout, which Outlook enforces", () => {
    const out = toIcs(bundle());
    expect(out).toContain("BEGIN:VCALENDAR\r\n");
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds long lines to 75 octets or fewer", () => {
    const out = toIcs(
      bundle({
        events: [
          {
            id: 1,
            title: "x".repeat(300),
            description: "",
            eventDate: new Date("2026-09-01T10:00:00Z"),
          },
        ],
      }),
    );

    const encoder = new TextEncoder();
    for (const line of out.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("counts octets, not characters, when folding Cyrillic", () => {
    // The launch market. Each character is two bytes, so a 60-character line is
    // 120 bytes — legal by a character count and illegal by the spec.
    const out = toIcs(
      bundle({
        events: [
          {
            id: 1,
            title: "Среща".repeat(40),
            description: "",
            eventDate: new Date("2026-09-01T10:00:00Z"),
          },
        ],
      }),
    );

    const encoder = new TextEncoder();
    for (const line of out.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("does not corrupt a multi-byte character at a fold boundary", () => {
    const title = "я".repeat(200);
    const out = toIcs(
      bundle({
        events: [
          { id: 1, title, description: "", eventDate: new Date("2026-09-01T10:00:00Z") },
        ],
      }),
    );

    // Unfolding is: remove CRLF + the single leading space. If a character were
    // split across the boundary it would not survive the round trip.
    const unfolded = out.replaceAll("\r\n ", "");
    expect(unfolded).toContain(title);
    expect(out).not.toContain("\uFFFD");
  });

  it("skips tasks with no due date, which have nowhere to go on a calendar", () => {
    const out = toIcs(bundle({ tasks: [task({ dueDate: null })] }));
    expect(out).not.toContain("BEGIN:VEVENT");
  });

  it("gives every entry a stable uid so re-import updates rather than duplicates", () => {
    const out = toIcs(bundle({ tasks: [task({ id: 42 })] }));
    expect(out).toContain("UID:task-42@kairos");
  });

  it("stamps times as UTC in basic format", () => {
    const out = toIcs(
      bundle({
        events: [
          {
            id: 1,
            title: "Standup",
            description: "",
            eventDate: new Date("2026-09-01T10:30:00Z"),
          },
        ],
      }),
    );

    expect(out).toContain("DTSTART:20260901T103000Z");
  });
});
