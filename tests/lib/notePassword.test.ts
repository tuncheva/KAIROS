import { describe, expect, it } from "vitest";

import { NOTE_PASSWORD_PATTERN, toNotePassword } from "~/lib/notePassword";

describe("note passwords", () => {
  it("accepts digits only", () => {
    expect(NOTE_PASSWORD_PATTERN.test("0042")).toBe(true);
    expect(NOTE_PASSWORD_PATTERN.test("12a4")).toBe(false);
    expect(NOTE_PASSWORD_PATTERN.test("12 34")).toBe(false);
    expect(NOTE_PASSWORD_PATTERN.test("")).toBe(false);
  });

  it("rejects non-ASCII digits the field would never produce", () => {
    // `\d` in a non-unicode regex is [0-9], so Arabic-Indic digits stay out.
    expect(NOTE_PASSWORD_PATTERN.test("١٢٣٤")).toBe(false);
  });

  it("drops everything but digits as the field is typed or pasted into", () => {
    expect(toNotePassword("12a3-4 5")).toBe("12345");
    expect(toNotePassword("pass")).toBe("");
    expect(toNotePassword("007")).toBe("007");
  });
});
