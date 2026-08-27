import { describe, it, expect } from "vitest";

import {
  bucketOf,
  countLockedExcluded,
  fromDateInputValue,
  groupNotes,
  noteTitle,
  notePreview,
  notebookIdOfView,
  selectNotes,
  toDateInputValue,
  wordCount,
  type NoteItem,
} from "~/components/notes/notesData";

/** Thursday 20 August 2026, 09:00 local. */
const NOW = new Date(2026, 7, 20, 9, 0, 0);
const at = (day: number, hour = 12) => new Date(2026, 7, day, hour, 0, 0);

const LABELS = { untitled: "Untitled", encrypted: "Encrypted note" };
const PREVIEW_LABELS = { locked: "Locked", empty: "No content" };

function note(overrides: Partial<NoteItem> & { id: number }): NoteItem {
  return {
    title: null,
    content: "",
    createdAt: at(20),
    updatedAt: at(20),
    notebookId: null,
    calendarDate: null,
    isPasswordProtected: false,
    kind: "own",
    sharedWith: [],
    permission: null,
    ownerName: null,
    ownerEmail: null,
    ...overrides,
  };
}

const person = (id: string) => ({ id, name: id, email: `${id}@x.io`, image: null });

describe("noteTitle", () => {
  it("prefers the stored title", () => {
    expect(noteTitle(note({ id: 1, title: "Q3 planning", content: "body" }), undefined, LABELS)).toBe(
      "Q3 planning",
    );
  });

  it("falls back to the first non-empty line of the body", () => {
    const untitled = note({ id: 1, content: "\n\n  Ask Ivan about rate limiting\nsecond line" });
    expect(noteTitle(untitled, undefined, LABELS)).toBe("Ask Ivan about rate limiting");
  });

  it("says the note is encrypted rather than inventing a title from nothing", () => {
    // `getAll` nulls the body of a protected note, so there is no line to borrow.
    const locked = note({ id: 1, content: null, isPasswordProtected: true });
    expect(noteTitle(locked, undefined, LABELS)).toBe("Encrypted note");
  });

  it("uses the decrypted body once the note is unlocked", () => {
    const locked = note({ id: 1, content: null, isPasswordProtected: true });
    expect(noteTitle(locked, "Salary review\nnumbers", LABELS)).toBe("Salary review");
  });

  it("reports an empty untitled note as untitled", () => {
    expect(noteTitle(note({ id: 1, content: "" }), undefined, LABELS)).toBe("Untitled");
  });
});

describe("notePreview", () => {
  it("skips the first line when it was borrowed for the title", () => {
    const untitled = note({ id: 1, content: "First line\nSecond line\nThird" });
    expect(notePreview(untitled, undefined, PREVIEW_LABELS)).toBe("Second line Third");
  });

  it("keeps the first line when the note has its own title", () => {
    const titled = note({ id: 1, title: "Retro", content: "First line\nSecond line" });
    expect(notePreview(titled, undefined, PREVIEW_LABELS)).toBe("First line Second line");
  });

  it("does not leak anything about a locked note", () => {
    const locked = note({ id: 1, content: null, isPasswordProtected: true });
    expect(notePreview(locked, undefined, PREVIEW_LABELS)).toBe("Locked");
  });

  it("reports a one-line untitled note as having no further content", () => {
    expect(notePreview(note({ id: 1, content: "Only a title line" }), undefined, PREVIEW_LABELS)).toBe(
      "No content",
    );
  });
});

describe("selectNotes", () => {
  const notes: NoteItem[] = [
    note({ id: 1, title: "Alpha", content: "rate limiting", updatedAt: at(20, 8), notebookId: 7 }),
    note({
      id: 2,
      title: "Beta",
      content: null,
      isPasswordProtected: true,
      updatedAt: at(19),
      createdAt: at(1),
    }),
    note({ id: 3, title: "Gamma", content: "vendor pricing", updatedAt: at(18), sharedWith: [person("u1")] }),
    note({ id: 4, title: "Delta", content: "reading list", updatedAt: at(17), calendarDate: at(28) }),
  ];
  const base = { view: "all", filter: "all", query: "", sort: "edited", unlocked: {}, locale: "en" } as const;

  it("orders by last edited, newest first", () => {
    expect(selectNotes({ notes, ...base }).map((n) => n.id)).toEqual([1, 2, 3, 4]);
  });

  it("orders by creation date when asked, which is a different order", () => {
    // Beta was created first but edited recently — the two sorts must disagree.
    expect(selectNotes({ notes, ...base, sort: "created" }).map((n) => n.id)).toEqual([1, 3, 4, 2]);
  });

  it("orders by title", () => {
    expect(selectNotes({ notes, ...base, sort: "title" }).map((n) => n.title)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma",
    ]);
  });

  it("keeps only the notes in a notebook", () => {
    expect(selectNotes({ notes, ...base, view: "notebook:7" }).map((n) => n.id)).toEqual([1]);
  });

  it("keeps only the notes with a calendar date", () => {
    expect(selectNotes({ notes, ...base, view: "calendar" }).map((n) => n.id)).toEqual([4]);
  });

  it("filters to locked, shared and unfiled notes", () => {
    expect(selectNotes({ notes, ...base, filter: "locked" }).map((n) => n.id)).toEqual([2]);
    expect(selectNotes({ notes, ...base, filter: "shared" }).map((n) => n.id)).toEqual([3]);
    expect(selectNotes({ notes, ...base, filter: "unfiled" }).map((n) => n.id)).toEqual([2, 3, 4]);
  });

  it("treats a note shared with you as shared even without a share list", () => {
    const inbound = note({ id: 9, kind: "shared", permission: "read", content: "hi" });
    expect(selectNotes({ notes: [inbound], ...base, filter: "shared" })).toHaveLength(1);
  });

  it("searches titles and bodies", () => {
    expect(selectNotes({ notes, ...base, query: "pricing" }).map((n) => n.id)).toEqual([3]);
    expect(selectNotes({ notes, ...base, query: "alph" }).map((n) => n.id)).toEqual([1]);
  });

  it("cannot search inside a locked note, but can once it is unlocked", () => {
    // The body only exists as ciphertext until `verifyPassword` returns it.
    expect(selectNotes({ notes, ...base, query: "salary" })).toHaveLength(0);
    expect(
      selectNotes({ notes, ...base, query: "salary", unlocked: { 2: "salary bands for H2" } }).map(
        (n) => n.id,
      ),
    ).toEqual([2]);
  });

  it("does not mutate the array it was given", () => {
    const original = [...notes];
    selectNotes({ notes, ...base, sort: "title" });
    expect(notes).toEqual(original);
  });
});

describe("countLockedExcluded", () => {
  const notes = [
    note({ id: 1, content: "plain" }),
    note({ id: 2, content: null, isPasswordProtected: true }),
    note({ id: 3, content: null, isPasswordProtected: true }),
  ];

  it("counts nothing when nobody is searching", () => {
    expect(countLockedExcluded(notes, "  ", {})).toBe(0);
  });

  it("counts the notes the search could not look inside", () => {
    expect(countLockedExcluded(notes, "budget", {})).toBe(2);
  });

  it("stops counting a note once it has been unlocked", () => {
    expect(countLockedExcluded(notes, "budget", { 2: "decrypted" })).toBe(1);
  });
});

describe("bucketOf and groupNotes", () => {
  it("buckets by calendar day, not elapsed hours", () => {
    // 23:59 yesterday is two minutes from 00:01 today, and a day apart to a reader.
    expect(bucketOf(new Date(2026, 7, 20, 0, 1), NOW)).toBe("today");
    expect(bucketOf(new Date(2026, 7, 19, 23, 59), NOW)).toBe("yesterday");
    expect(bucketOf(at(16), NOW)).toBe("week");
    expect(bucketOf(at(1), NOW)).toBe("month");
    expect(bucketOf(new Date(2026, 5, 1), NOW)).toBe("older");
  });

  it("groups a date-ordered list under headings, in order", () => {
    const groups = groupNotes(
      [
        note({ id: 1, updatedAt: at(20, 8) }),
        note({ id: 2, updatedAt: at(19) }),
        note({ id: 3, updatedAt: at(16) }),
      ],
      "edited",
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["today", "yesterday", "week"]);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual([1]);
  });

  it("drops the headings when the list is alphabetical, where dates mean nothing", () => {
    const groups = groupNotes([note({ id: 1 }), note({ id: 2 })], "title", NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
  });
});

describe("calendar date inputs", () => {
  it("round-trips a date through the input without drifting a day", () => {
    // A UTC ISO slice would report the 2nd for anyone east of Greenwich.
    const parsed = fromDateInputValue("2026-09-03");
    expect(toDateInputValue(parsed)).toBe("2026-09-03");
    expect(parsed?.getHours()).toBe(12);
    expect(parsed?.getDate()).toBe(3);
  });

  it("treats an empty input as no date", () => {
    expect(fromDateInputValue("")).toBeNull();
    expect(toDateInputValue(null)).toBe("");
  });
});

describe("small helpers", () => {
  it("counts words, ignoring padding", () => {
    expect(wordCount("  three little   words \n")).toBe(3);
    expect(wordCount("   ")).toBe(0);
  });

  it("reads the notebook id out of a rail view", () => {
    expect(notebookIdOfView("notebook:7")).toBe(7);
    expect(notebookIdOfView("all")).toBeNull();
  });
});
