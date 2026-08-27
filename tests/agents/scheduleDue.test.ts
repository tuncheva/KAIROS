/**
 * Scheduling: does a brief fire at the user's chosen hour, in the user's zone?
 *
 * `isScheduleDue` is the whole of the decision the sweep makes, lifted out of
 * the query so it can be exercised without a database. The bug it replaces was
 * not subtle in effect — a 07:00 brief landing at 09:00 in Bulgaria, and moving
 * by an hour every spring and autumn — but it was invisible in code, because
 * comparing an `hour_utc` column against `now.getUTCHours()` looks correct until
 * you ask whose hour it is.
 *
 * The fall-back case at the bottom is the one worth reading twice. On 25 October
 * 2026, 03:30 happens twice in Sofia; a naive "has an hour passed since the last
 * run" check sends a second brief during the repeated hour.
 */

import { describe, expect, it } from "vitest";

import { isScheduleDue } from "~/server/llm/scheduled/due";

/** 07:00 daily, never run, in the launch market. */
function sofia(overrides: Partial<Parameters<typeof isScheduleDue>[0]> = {}) {
  return {
    hourLocal: 7,
    lastRunAt: null,
    timeZone: "Europe/Sofia",
    ...overrides,
  };
}

describe("isScheduleDue — the hour", () => {
  it("does not fire before the chosen hour arrives locally", () => {
    // 04:00 UTC is 06:00 in Sofia in January. Not yet.
    expect(isScheduleDue(sofia(), new Date("2026-01-15T04:00:00Z"))).toBe(false);
  });

  it("fires once the chosen hour arrives locally", () => {
    // 05:00 UTC is 07:00 in Sofia in January.
    expect(isScheduleDue(sofia(), new Date("2026-01-15T05:00:00Z"))).toBe(true);
  });

  it("tracks the same wall-clock hour across a DST change", () => {
    // The regression this whole item exists to prevent. A brief set for 07:00
    // must fire at 07:00 Sofia in both seasons, which is two different UTC
    // instants — 05:00 UTC in winter, 04:00 UTC in summer.
    expect(isScheduleDue(sofia(), new Date("2026-01-15T05:00:00Z"))).toBe(true);
    expect(isScheduleDue(sofia(), new Date("2026-07-15T04:00:00Z"))).toBe(true);

    // And must *not* fire an hour early in either.
    expect(isScheduleDue(sofia(), new Date("2026-01-15T04:00:00Z"))).toBe(false);
    expect(isScheduleDue(sofia(), new Date("2026-07-15T03:00:00Z"))).toBe(false);
  });

  it("still fires when the sweep is late", () => {
    // The sweep is hourly and can miss a tick. "At or past" rather than "equal
    // to" is what stops a restart at 07:05 costing someone their brief.
    expect(isScheduleDue(sofia(), new Date("2026-01-15T14:00:00Z"))).toBe(true);
  });

  it("treats hour 0 as a real choice rather than as unset", () => {
    // Midnight must compare as 0, not 24 — see the h23 cycle in `~/lib/timezone`.
    const midnight = sofia({ hourLocal: 0 });
    expect(isScheduleDue(midnight, new Date("2026-01-14T22:30:00Z"))).toBe(true);
  });
});

describe("isScheduleDue — the day", () => {
  it("does not fire twice on the same local day", () => {
    const ranThisMorning = sofia({
      lastRunAt: new Date("2026-01-15T05:00:00Z"), // 07:00 Sofia
    });

    expect(
      isScheduleDue(ranThisMorning, new Date("2026-01-15T11:00:00Z")),
    ).toBe(false);
  });

  it("fires again the next local day", () => {
    const ranYesterday = sofia({
      lastRunAt: new Date("2026-01-15T05:00:00Z"),
    });

    expect(isScheduleDue(ranYesterday, new Date("2026-01-16T05:00:00Z"))).toBe(
      true,
    );
  });

  it("uses the user's midnight, not UTC's, to decide the day rolled over", () => {
    // Sofia is two hours ahead in January, so 22:30 UTC is already tomorrow
    // there. A schedule that ran at 07:00 Sofia should be due again at 00:30
    // Sofia the next day if the hour allows it — here hour 0.
    const midnight = sofia({
      hourLocal: 0,
      lastRunAt: new Date("2026-01-15T05:00:00Z"), // 07:00 Sofia on the 15th
    });

    // 22:30 UTC on the 15th is 00:30 Sofia on the 16th — a new local day.
    expect(isScheduleDue(midnight, new Date("2026-01-15T22:30:00Z"))).toBe(true);
  });

  it("does not send a second brief during a repeated hour", () => {
    // 25 October 2026: Sofia falls back, so 03:30 local occurs twice. A run in
    // the first 03:30 must suppress the second — both are the same local day.
    const ranInFirstPass = sofia({
      hourLocal: 3,
      lastRunAt: new Date("2026-10-25T00:30:00Z"), // 03:30 Sofia, UTC+3
    });

    expect(
      isScheduleDue(ranInFirstPass, new Date("2026-10-25T01:30:00Z")), // 03:30 again, UTC+2
    ).toBe(false);
  });
});

describe("isScheduleDue — weekly schedules", () => {
  /** The retrospective's shipped default: Friday at 16:00. */
  function friday(overrides: Partial<Parameters<typeof isScheduleDue>[0]> = {}) {
    return {
      hourLocal: 16,
      dayOfWeek: 5,
      lastRunAt: null,
      timeZone: "Europe/Sofia",
      ...overrides,
    };
  }

  it("fires on its day once the hour arrives", () => {
    // 2026-08-21 is a Friday. 13:00 UTC is 16:00 Sofia in summer.
    expect(isScheduleDue(friday(), new Date("2026-08-21T13:00:00Z"))).toBe(true);
  });

  it("does not fire on any other day", () => {
    // Thursday and Saturday, both well past 16:00 locally.
    expect(isScheduleDue(friday(), new Date("2026-08-20T18:00:00Z"))).toBe(false);
    expect(isScheduleDue(friday(), new Date("2026-08-22T18:00:00Z"))).toBe(false);
  });

  it("does not fire before its hour on its own day", () => {
    // Friday, but 09:00 Sofia.
    expect(isScheduleDue(friday(), new Date("2026-08-21T06:00:00Z"))).toBe(false);
  });

  it("judges the weekday in the user's zone", () => {
    // 22:00 UTC on Friday is Saturday 01:00 in Sofia — no longer its day, even
    // though a UTC clock still says Friday.
    expect(isScheduleDue(friday(), new Date("2026-08-21T22:00:00Z"))).toBe(false);

    // And the mirror case: 02:00 UTC Saturday is still Friday 22:00 in New York.
    const nyc = friday({ timeZone: "America/New_York", hourLocal: 20 });
    expect(isScheduleDue(nyc, new Date("2026-08-22T02:00:00Z"))).toBe(true);
  });

  it("does not fire twice on the same Friday", () => {
    const alreadyRan = friday({
      lastRunAt: new Date("2026-08-21T13:00:00Z"),
    });

    expect(isScheduleDue(alreadyRan, new Date("2026-08-21T17:00:00Z"))).toBe(
      false,
    );
  });

  it("waits a whole week rather than catching up the next day", () => {
    // A sweep that never ran on Friday does not deliver on Saturday. A
    // retrospective describes a window that has since moved; late is worse than
    // absent. Documented in `isScheduleDue` because it is a choice, not a gap.
    const missedFriday = friday({
      lastRunAt: new Date("2026-08-14T13:00:00Z"), // the previous Friday
    });

    expect(isScheduleDue(missedFriday, new Date("2026-08-22T13:00:00Z"))).toBe(
      false,
    );
    expect(isScheduleDue(missedFriday, new Date("2026-08-28T13:00:00Z"))).toBe(
      true,
    );
  });

  it("treats a null dayOfWeek as every day", () => {
    // The two shipped kinds have no day, and must keep behaving as they did
    // before the column existed.
    const daily = friday({ dayOfWeek: null });

    expect(isScheduleDue(daily, new Date("2026-08-20T13:00:00Z"))).toBe(true);
    expect(isScheduleDue(daily, new Date("2026-08-21T13:00:00Z"))).toBe(true);
  });

  it("treats an absent dayOfWeek as every day", () => {
    // Rows read before the column was selected, and every call site that does
    // not care, pass no key at all.
    const noKey = { hourLocal: 7, lastRunAt: null, timeZone: "Europe/Sofia" };
    expect(isScheduleDue(noKey, new Date("2026-08-20T05:00:00Z"))).toBe(true);
  });

  it("fires on Sunday when Sunday is the chosen day", () => {
    // dayOfWeek 0 must not be confused with "unset" — the same trap as hour 0.
    const sunday = friday({ dayOfWeek: 0 });
    expect(isScheduleDue(sunday, new Date("2026-08-23T13:00:00Z"))).toBe(true);
    expect(isScheduleDue(sunday, new Date("2026-08-21T13:00:00Z"))).toBe(false);
  });
});

describe("isScheduleDue — degradation", () => {
  it("falls back to UTC when a user has no zone stored", () => {
    const noZone = { hourLocal: 7, lastRunAt: null, timeZone: null };

    expect(isScheduleDue(noZone, new Date("2026-01-15T07:00:00Z"))).toBe(true);
    expect(isScheduleDue(noZone, new Date("2026-01-15T06:00:00Z"))).toBe(false);
  });

  it("falls back to UTC rather than throwing on an unknown zone", () => {
    // One bad row must not take down the sweep for every user processed after
    // it. Degrading to the pre-timezone behaviour is the honest failure.
    const typo = { hourLocal: 7, lastRunAt: null, timeZone: "Europe/Sofa" };

    expect(isScheduleDue(typo, new Date("2026-01-15T07:00:00Z"))).toBe(true);
  });
});
