/**
 * The weekly retrospective's two model-free decisions.
 *
 * `collectRetroFacts` needs a database and is not covered here; what is covered
 * is everything that decides whether a user hears from the product at all, and
 * what they hear when the model is unavailable. Both run on every send, including
 * the sends where inference failed, so they are the parts that must not be wrong.
 *
 * The distinction from `briefIsEmpty` is the thing most likely to be "corrected"
 * by someone later, so it is asserted directly rather than left as a comment.
 */

import { describe, expect, it } from "vitest";

import {
  fallbackRetro,
  retroIsEmpty,
  type RetroFacts,
} from "~/server/llm/scheduled/weeklyRetro";

function facts(overrides: Partial<RetroFacts> = {}): RetroFacts {
  return {
    completed: 0,
    completedSample: [],
    created: 0,
    carriedOver: 0,
    stalled: [],
    eventsHeld: 0,
    findingsRaised: 0,
    findingsDismissed: 0,
    overdueNow: 0,
    ...overrides,
  };
}

describe("retroIsEmpty", () => {
  it("suppresses a week in which nothing happened and nothing is outstanding", () => {
    expect(retroIsEmpty(facts())).toBe(true);
  });

  it("sends a week that was purely good news", () => {
    // The deliberate divergence from the daily brief. "You closed eleven things
    // and nothing is stalled" is worth saying once a week, where "nothing is due
    // today" every morning is how people learn to stop reading.
    expect(retroIsEmpty(facts({ completed: 11 }))).toBe(false);
  });

  it("sends when work only came in", () => {
    expect(retroIsEmpty(facts({ created: 4 }))).toBe(false);
  });

  it("sends when nothing moved but work is outstanding", () => {
    // The most important non-empty case: a week where the user did nothing is
    // exactly when a retrospective earns its place.
    expect(retroIsEmpty(facts({ carriedOver: 6 }))).toBe(false);
    expect(retroIsEmpty(facts({ overdueNow: 2 }))).toBe(false);
  });

  it("sends when something has stalled", () => {
    expect(
      retroIsEmpty(
        facts({
          stalled: [{ id: 1, title: "Ship the invoice export", projectTitle: "Delta", days: 21 }],
        }),
      ),
    ).toBe(false);
  });

  it("sends when only events happened", () => {
    expect(retroIsEmpty(facts({ eventsHeld: 1 }))).toBe(false);
  });

  it("does not send on findings alone", () => {
    // Findings are a restatement of task state the other fields already cover.
    // A week whose only content is "the radar noticed something" has nothing to
    // review that the daily brief did not already say, on the day it mattered.
    expect(retroIsEmpty(facts({ findingsRaised: 3, findingsDismissed: 3 }))).toBe(
      true,
    );
  });
});

describe("fallbackRetro", () => {
  it("always states the headline comparison, including zeroes", () => {
    // Completed-versus-created is the shape of the week. Omitting a zero would
    // make "0 completed, 9 created" read as a week with no intake.
    expect(fallbackRetro(facts({ completed: 0, created: 9 }))).toContain(
      "0 task(s) completed, 9 created",
    );
  });

  it("names stalled items rather than only counting them", () => {
    const out = fallbackRetro(
      facts({
        completed: 3,
        stalled: [
          { id: 1, title: "Ship the invoice export", projectTitle: "Delta", days: 21 },
          { id: 2, title: "Rewrite the onboarding copy", projectTitle: "Delta", days: 30 },
        ],
      }),
    );

    expect(out).toContain("Ship the invoice export");
    expect(out).toContain("Rewrite the onboarding copy");
  });

  it("omits sections with nothing in them", () => {
    const out = fallbackRetro(facts({ completed: 2, created: 2 }));

    expect(out).not.toContain("carried over");
    expect(out).not.toContain("overdue");
    expect(out).not.toContain("event");
  });

  it("never returns an empty string", () => {
    // It is only ever called for a week that `retroIsEmpty` already passed, but
    // an empty notification body is a worse failure than a dull one.
    expect(fallbackRetro(facts()).length).toBeGreaterThan(0);
  });

  it("states only numbers it was given", () => {
    // The floor's whole value is that it cannot be wrong. Anything resembling an
    // invented count would defeat the purpose of having a model-free path.
    const out = fallbackRetro(facts({ completed: 4, created: 1, carriedOver: 7 }));

    expect(out).toContain("4 task(s) completed");
    expect(out).toContain("1 created");
    expect(out).toContain("7 open task(s) carried over");
  });
});
