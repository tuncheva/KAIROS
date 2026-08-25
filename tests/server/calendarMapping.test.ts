/**
 * Google Calendar event mapping, and the OAuth state signature.
 *
 * Two pure surfaces, and both fail in ways that are invisible from the outside.
 *
 * **Mapping** has to survive shapes Google actually sends: an all-day event
 * carries `date` instead of `dateTime`, a cancelled instance of a recurring event
 * carries almost nothing at all, and a titled-by-nobody event has no `summary`.
 * Each of those is a row that either lands correctly or lands a day out, in the
 * wrong place, or as a crash mid-sync.
 *
 * **State signing** is the CSRF defence for the callback. Without it, a crafted
 * callback URL could bind the attacker's calendar to whoever clicks it — so the
 * tests here are mostly forgeries and stale tokens rather than the happy path.
 */

import { describe, expect, it, vi } from "vitest";

/**
 * `~/env` refuses to hand a server-only variable to anything it thinks is client
 * code, which includes the test runner. The signing key is the only thing these
 * modules read from it, so a fixed one is supplied — and a fixed key is what
 * makes the forgery tests deterministic anyway.
 */
vi.mock("~/env", () => ({
  env: { AUTH_SECRET: "test-secret-at-least-32-characters-long" },
}));

const { mapEvent } = await import("~/server/calendar/google");
type GoogleEvent = Parameters<typeof mapEvent>[0];

const { STATE_TTL_MS, signState, verifyState } = await import(
  "~/server/calendar/state"
);

function event(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "evt_1",
    summary: "Standup",
    status: "confirmed",
    start: { dateTime: "2026-09-01T09:00:00Z" },
    end: { dateTime: "2026-09-01T09:15:00Z" },
    ...overrides,
  };
}

describe("mapEvent — ordinary events", () => {
  it("maps a timed event", () => {
    const mapped = mapEvent(event());

    expect(mapped).toMatchObject({
      externalId: "evt_1",
      title: "Standup",
      allDay: false,
      status: "confirmed",
    });
    expect(mapped?.startsAt.toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("counts attendees and reads the owner's own response", () => {
    const mapped = mapEvent(
      event({
        attendees: [
          { self: true, responseStatus: "accepted" },
          { responseStatus: "needsAction" },
          { responseStatus: "declined" },
        ],
      }),
    );

    expect(mapped?.attendeeCount).toBe(3);
    expect(mapped?.selfResponse).toBe("accepted");
  });

  it("reports no response when the owner is not an attendee", () => {
    // An event the user created and did not invite themselves to.
    const mapped = mapEvent(event({ attendees: [{ responseStatus: "accepted" }] }));
    expect(mapped?.selfResponse).toBeNull();
  });
});

describe("mapEvent — all-day events", () => {
  it("recognises a date-only event", () => {
    const mapped = mapEvent(
      event({ start: { date: "2026-09-01" }, end: { date: "2026-09-02" } }),
    );

    expect(mapped?.allDay).toBe(true);
  });

  it("anchors an all-day event to UTC midnight, not the server's zone", () => {
    // The bug this prevents: parsing "2026-09-01" in local time puts the event on
    // 31 August for anyone west of UTC and keeps it on the 1st for everyone east,
    // so the same event lands on different days depending on where the server is.
    const mapped = mapEvent(event({ start: { date: "2026-09-01" } }));

    expect(mapped?.startsAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("treats an all-day end date the same way", () => {
    const mapped = mapEvent(
      event({ start: { date: "2026-09-01" }, end: { date: "2026-09-03" } }),
    );

    expect(mapped?.endsAt?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });
});

describe("mapEvent — awkward shapes", () => {
  it("skips an event with no start at all", () => {
    // A cancelled instance of a recurring event: an id, a status, nothing else.
    // There is nothing to place on a calendar, and returning a row with an
    // invalid date would poison every query that sorts by it.
    expect(mapEvent({ id: "evt_x", status: "cancelled" })).toBeNull();
  });

  it("skips an unparseable start", () => {
    expect(mapEvent(event({ start: { dateTime: "not a date" } }))).toBeNull();
  });

  it("gives an untitled event the label Google's own UI uses", () => {
    // An empty string would render as a blank row that looks like a bug.
    const mapped = mapEvent(event({ summary: undefined }));
    expect(mapped?.title).toBe("(no title)");
  });

  it("tolerates a missing end", () => {
    const mapped = mapEvent(event({ end: undefined }));

    expect(mapped).not.toBeNull();
    expect(mapped?.endsAt).toBeNull();
  });

  it("preserves cancelled and tentative status", () => {
    // Cancellation has to survive: an incremental sync reports it as a status
    // change, and dropping it would leave a stale meeting on the calendar.
    expect(mapEvent(event({ status: "cancelled" }))?.status).toBe("cancelled");
    expect(mapEvent(event({ status: "tentative" }))?.status).toBe("tentative");
  });

  it("normalises an unrecognised status rather than storing it", () => {
    expect(mapEvent(event({ status: "something_new" }))?.status).toBe("confirmed");
  });

  it("truncates a very long title and description", () => {
    const mapped = mapEvent(
      event({ summary: "x".repeat(900), description: "y".repeat(9000) }),
    );

    expect(mapped!.title.length).toBeLessThanOrEqual(512);
    expect(mapped!.description!.length).toBeLessThanOrEqual(4000);
  });

  it("handles Cyrillic titles without corruption", () => {
    const mapped = mapEvent(event({ summary: "Среща с екипа" }));
    expect(mapped?.title).toBe("Среща с екипа");
  });
});

describe("OAuth state", () => {
  const USER = "user_abc";

  it("round-trips the user who started the flow", () => {
    const now = Date.now();
    const verified = verifyState(signState(USER, now), now);

    expect(verified?.userId).toBe(USER);
  });

  it("rejects a forged signature", () => {
    // The whole point. A callback that trusted an unsigned user id would let a
    // crafted link attach the attacker's calendar to whoever clicked it.
    const state = signState(USER, Date.now());
    const [payload] = state.split(".");
    expect(verifyState(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    // Re-encoding a different user id without re-signing.
    const forged = Buffer.from(`victim.${String(Date.now())}`).toString(
      "base64url",
    );
    const state = signState(USER, Date.now());
    const mac = state.split(".")[1]!;

    expect(verifyState(`${forged}.${mac}`)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyState("")).toBeNull();
    expect(verifyState("nodot")).toBeNull();
    expect(verifyState("....")).toBeNull();
  });

  it("rejects a state older than its window", () => {
    const issued = Date.now() - STATE_TTL_MS - 1_000;
    expect(verifyState(signState(USER, issued))).toBeNull();
  });

  it("accepts one issued just inside the window", () => {
    const issued = Date.now() - (STATE_TTL_MS - 5_000);
    expect(verifyState(signState(USER, issued))?.userId).toBe(USER);
  });

  it("rejects a state from the future", () => {
    // Clock skew beyond a minute means something is wrong; a far-future issuedAt
    // would otherwise be valid indefinitely.
    const issued = Date.now() + 10 * 60 * 1000;
    expect(verifyState(signState(USER, issued))).toBeNull();
  });

  it("keeps a user id containing dots intact", () => {
    // Ids are opaque strings. Splitting on the first dot rather than the last
    // would truncate one and verify a different user.
    const dotted = "user.with.dots";
    const now = Date.now();

    expect(verifyState(signState(dotted, now), now)?.userId).toBe(dotted);
  });
});
