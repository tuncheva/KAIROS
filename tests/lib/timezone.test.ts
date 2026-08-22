/**
 * Wall-clock reading: does the scheduler know what time it is where the user is?
 *
 * The bug these tests pin is the one the pricing memo calls a launch blocker —
 * a 07:00 brief arriving at 09:00 in Bulgaria and moving by an hour twice a year
 * without anyone touching a setting. The assertions are therefore mostly about
 * DST, because a naive offset implementation passes every non-DST test and fails
 * exactly the two days a year that make the feature look broken.
 *
 * Bulgaria is the worked example throughout: UTC+2 in winter, UTC+3 in summer,
 * and the launch market.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  localDayKeyIn,
  localHourIn,
  supportedTimeZones,
} from "~/lib/timezone";

describe("localHourIn", () => {
  it("reads the hour in the target zone, not the host's", () => {
    // 05:00 UTC in January is 07:00 in Sofia (UTC+2).
    const at = new Date("2026-01-15T05:00:00Z");
    expect(localHourIn("Europe/Sofia", at)).toBe(7);
    expect(localHourIn("UTC", at)).toBe(5);
  });

  it("follows the zone across a DST transition", () => {
    // The whole point. 04:00 UTC is 07:00 in Sofia in summer (UTC+3) and 06:00
    // in winter (UTC+2). A stored numeric offset gets one of these wrong.
    const summer = new Date("2026-07-15T04:00:00Z");
    const winter = new Date("2026-01-15T04:00:00Z");

    expect(localHourIn("Europe/Sofia", summer)).toBe(7);
    expect(localHourIn("Europe/Sofia", winter)).toBe(6);
  });

  it("reports midnight as 0 rather than 24", () => {
    // With the h24 cycle midnight formats as "24", which compares as later than
    // every possible scheduled hour — so every schedule would look due at once,
    // once a day.
    expect(localHourIn("UTC", new Date("2026-03-01T00:30:00Z"))).toBe(0);
    expect(localHourIn("Europe/Sofia", new Date("2026-03-01T22:30:00Z"))).toBe(0);
  });

  it("handles zones that are not a whole number of hours off UTC", () => {
    // Kolkata is UTC+5:30. Truncating to whole hours is a common shortcut that
    // this must not take.
    expect(localHourIn("Asia/Kolkata", new Date("2026-01-15T04:00:00Z"))).toBe(9);
    expect(localHourIn("Asia/Kolkata", new Date("2026-01-15T03:00:00Z"))).toBe(8);
  });

  it("crosses the date line without reporting a negative hour", () => {
    // Auckland is well ahead; Honolulu well behind. Both are on a different
    // calendar day from UTC at this instant.
    const at = new Date("2026-01-15T22:00:00Z");
    expect(localHourIn("Pacific/Auckland", at)).toBe(11);
    expect(localHourIn("Pacific/Honolulu", at)).toBe(12);
  });

  it("falls back to UTC for a zone the runtime does not know", () => {
    // One user's bad row must not throw inside a batch. Degrading to the
    // previous behaviour is the honest failure.
    const at = new Date("2026-01-15T05:00:00Z");
    expect(localHourIn("Europe/Sofa", at)).toBe(5);
  });
});

describe("localDayKeyIn", () => {
  it("gives the local calendar date, which can differ from the UTC one", () => {
    // 23:00 UTC is already tomorrow in Sofia.
    const at = new Date("2026-01-15T23:00:00Z");
    expect(localDayKeyIn("UTC", at)).toBe("2026-01-15");
    expect(localDayKeyIn("Europe/Sofia", at)).toBe("2026-01-16");
  });

  it("zero-pads so keys sort and compare as strings", () => {
    expect(localDayKeyIn("UTC", new Date("2026-03-05T12:00:00Z"))).toBe(
      "2026-03-05",
    );
  });

  it("holds a single day key across a spring-forward transition", () => {
    // EU clocks jump at 01:00 UTC on the last Sunday of March — 03:00 Sofia
    // becomes 04:00. Both instants are still the 29th locally, so a run at
    // either must count as "already ran today". Computing a midnight instant
    // and comparing against it is what gets this wrong by an hour.
    const before = new Date("2026-03-29T00:30:00Z"); // 02:30 Sofia, UTC+2
    const after = new Date("2026-03-29T01:30:00Z"); // 04:30 Sofia, UTC+3

    expect(localDayKeyIn("Europe/Sofia", before)).toBe("2026-03-29");
    expect(localDayKeyIn("Europe/Sofia", after)).toBe("2026-03-29");
  });

  it("holds a single day key across an autumn fall-back transition", () => {
    // The harder direction: 03:00 Sofia happens twice on 25 October 2026.
    const first = new Date("2026-10-25T00:30:00Z"); // 03:30 Sofia, UTC+3
    const second = new Date("2026-10-25T01:30:00Z"); // 03:30 Sofia, UTC+2

    expect(localHourIn("Europe/Sofia", first)).toBe(3);
    expect(localHourIn("Europe/Sofia", second)).toBe(3);
    expect(localDayKeyIn("Europe/Sofia", first)).toBe("2026-10-25");
    expect(localDayKeyIn("Europe/Sofia", second)).toBe("2026-10-25");
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA identifiers", () => {
    expect(isValidTimeZone("Europe/Sofia")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects anything the runtime cannot resolve", () => {
    // The column is free-text `varchar`, so this is the only thing standing
    // between a typo in a form and a formatter that throws on every sweep.
    expect(isValidTimeZone("Europe/Sofa")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("not a zone")).toBe(false);
  });

  it("rejects a bare offset, which is not a zone", () => {
    // "+02:00" describes today in Sofia and is wrong there for half the year.
    expect(isValidTimeZone("+02:00")).toBe(false);
  });
});

describe("supportedTimeZones", () => {
  it("offers the full IANA set rather than a curated handful", () => {
    const zones = supportedTimeZones();

    // The previous picker listed six. A scheduling feature that only works if
    // the user happens to live in one of six places is not a scheduling feature.
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain("Europe/Sofia");
    expect(zones).toContain("America/Sao_Paulo");
  });

  it("only offers zones that validate", () => {
    for (const zone of supportedTimeZones()) {
      expect(isValidTimeZone(zone), zone).toBe(true);
    }
  });
});

describe("DEFAULT_TIME_ZONE", () => {
  it("is itself a valid zone", () => {
    expect(isValidTimeZone(DEFAULT_TIME_ZONE)).toBe(true);
  });
});
