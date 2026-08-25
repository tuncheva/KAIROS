/**
 * Meeting prep: the keyword extraction, the empty rule, and the fallback.
 *
 * `collectPrepFacts` needs a database and is not covered here. What is covered is
 * the part that decides whether the message is worth reading.
 *
 * Keyword matching is the interesting one. A meeting is linked to tasks by the
 * words in its title, and the failure mode is not an error — it is a brief full
 * of irrelevance. "Weekly sync" matching every task containing "weekly" produces
 * a message that is technically correct and useless, and a user who gets two of
 * those turns the feature off.
 */

import { describe, expect, it } from "vitest";

import {
  PREP_HORIZON_MINUTES,
  fallbackPrep,
  keywordsFrom,
  prepIsEmpty,
  type PrepFacts,
} from "~/server/llm/scheduled/meetingPrep";

function meeting(overrides: Partial<PrepFacts["meetings"][number]> = {}) {
  return {
    id: 1,
    title: "Invoice export review",
    startsAt: new Date("2026-09-01T14:00:00Z"),
    location: null,
    attendeeCount: 3,
    relatedTasks: [],
    ...overrides,
  };
}

describe("keywordsFrom", () => {
  it("keeps the words that identify the meeting", () => {
    expect(keywordsFrom("Invoice export review")).toContain("invoice");
    expect(keywordsFrom("Invoice export review")).toContain("export");
  });

  it("drops meeting boilerplate", () => {
    // The load-bearing case. Without this, "Weekly sync" matches every task
    // containing "weekly" and the brief fills with noise.
    const words = keywordsFrom("Weekly sync");
    expect(words).not.toContain("weekly");
    expect(words).not.toContain("sync");
  });

  it("drops words too short to be distinctive", () => {
    // Three-letter words match far too much to be useful as a search term.
    expect(keywordsFrom("Q4 ops cal")).toEqual([]);
  });

  it("returns nothing for a title made only of boilerplate", () => {
    // Correct, and the caller relies on it: no keywords means no task lookup,
    // rather than a lookup that matches everything.
    expect(keywordsFrom("Daily standup")).toEqual([]);
    expect(keywordsFrom("Catch up")).toEqual([]);
  });

  it("deduplicates", () => {
    const words = keywordsFrom("Invoice invoice INVOICE");
    expect(words).toEqual(["invoice"]);
  });

  it("caps how many it searches on", () => {
    // Each keyword is an extra LIKE in the query; unbounded titles would produce
    // unbounded predicates.
    const words = keywordsFrom(
      "migration invoice export billing reconciliation ledger accounts",
    );
    expect(words.length).toBeLessThanOrEqual(4);
  });

  it("handles Cyrillic titles", () => {
    // `\\p{L}` rather than `a-z`: splitting on non-ASCII would reduce every
    // Bulgarian title to nothing.
    const words = keywordsFrom("Среща за фактурите");
    expect(words).toContain("фактурите");
  });

  it("survives punctuation and emoji", () => {
    const words = keywordsFrom("🚀 Invoice-export / review (Q4)");
    expect(words).toContain("invoice");
    expect(words).toContain("export");
  });
});

describe("prepIsEmpty", () => {
  it("is empty with no meetings", () => {
    expect(prepIsEmpty({ meetings: [] })).toBe(true);
  });

  it("is not empty with a meeting, even one with no related work", () => {
    // "You have a call in 20 minutes" is worth sending on its own. Requiring
    // related tasks would suppress the message most likely to be useful.
    expect(prepIsEmpty({ meetings: [meeting()] })).toBe(false);
  });
});

describe("fallbackPrep", () => {
  it("states the time and the meeting", () => {
    const out = fallbackPrep({ meetings: [meeting()] });

    expect(out).toContain("14:00");
    expect(out).toContain("Invoice export review");
  });

  it("names related tasks when there are any", () => {
    const out = fallbackPrep({
      meetings: [
        meeting({
          relatedTasks: [
            { title: "Ship the invoice export", status: "pending", projectTitle: "Delta" },
          ],
        }),
      ],
    });

    expect(out).toContain("Ship the invoice export");
  });

  it("says nothing about related work when there is none", () => {
    const out = fallbackPrep({ meetings: [meeting()] });
    expect(out).not.toContain("Related");
  });

  it("covers several meetings in one message", () => {
    // One message per meeting would be five interruptions for a busy afternoon,
    // each arriving before the last one had started.
    const out = fallbackPrep({
      meetings: [
        meeting({ id: 1, title: "First" }),
        meeting({ id: 2, title: "Second", startsAt: new Date("2026-09-01T15:00:00Z") }),
      ],
    });

    expect(out).toContain("First");
    expect(out).toContain("Second");
    expect(out).toContain("15:00");
  });

  it("never returns an empty string for a non-empty window", () => {
    expect(fallbackPrep({ meetings: [meeting()] }).length).toBeGreaterThan(0);
  });
});

describe("PREP_HORIZON_MINUTES", () => {
  it("is wider than the hourly sweep interval", () => {
    // The reason it is 90 and not 30: a sweep runs hourly, so a thirty-minute
    // horizon would miss any meeting whose lead time fell between two ticks —
    // the brief would arrive after the meeting started, or never.
    expect(PREP_HORIZON_MINUTES).toBeGreaterThan(60);
  });
});
