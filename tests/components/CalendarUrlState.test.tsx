import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CalendarClient } from "~/components/calendar/CalendarClient";

/**
 * P1-36 — which period you are looking at belongs in the URL.
 *
 * It was component state only, so the back button walked out of the calendar
 * rather than back a week, a reload always landed on this week, and "look at
 * the 14th" could not be sent to anyone.
 *
 * These assert the round trip both ways: the URL seeds the view, and moving
 * around writes it back. `replaceState` rather than a push is deliberate and
 * asserted — each arrow press becoming a history entry is its own defect.
 */
describe("calendar state lives in the URL", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/calendar");
  });

  const params = () => new URLSearchParams(window.location.search);

  it("opens on the period the URL names", async () => {
    window.history.replaceState(null, "", "/calendar?view=month&date=2026-03-14");

    render(<CalendarClient />);

    // The skeleton clears once the client clock is known.
    await waitFor(() => {
      expect(params().get("view")).toBe("month");
    });
    expect(params().get("date")).toBe("2026-03-14");
  });

  it("falls back to this week when the URL says something it cannot use", async () => {
    window.history.replaceState(null, "", "/calendar?view=decade&date=not-a-date");

    render(<CalendarClient />);

    await waitFor(() => {
      expect(params().get("view")).toBe("week");
    });
    // A real date, rather than the unparseable one it was handed.
    expect(params().get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("writes the period back as you move, without stacking history entries", async () => {
    const user = userEvent.setup();
    render(<CalendarClient />);

    await waitFor(() => expect(params().get("date")).toBeTruthy());
    const before = params().get("date");
    const historyBefore = window.history.length;

    const next = await screen.findByRole("button", { name: /next/i });
    await user.click(next);

    await waitFor(() => expect(params().get("date")).not.toBe(before));
    /* `replaceState`, so stepping through a month does not leave the user
       pressing Back thirty times to escape the page. */
    expect(window.history.length).toBe(historyBefore);
  });
});
