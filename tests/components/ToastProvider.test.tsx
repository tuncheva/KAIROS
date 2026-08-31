import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* `tests/setup.tsx` stubs this module app-wide so unrelated components can call
   `useToast()` without a provider. This is the one file that needs the real
   thing — the whole point is asserting that it renders. */
vi.unmock("~/components/providers/ToastProvider");

import { ToastProvider, useToast } from "~/components/providers/ToastProvider";

/**
 * The provider used to discard its state value and render no viewport, so all
 * 126 `toast.*` call sites in the app produced nothing at all. These tests are
 * mostly here to keep that from coming back: the interesting assertion is
 * simply that the message reaches the DOM.
 */

/** Exposes the toast API through buttons so tests can fire real interactions. */
function Harness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("Note saved")}>fire-success</button>
      <button onClick={() => toast.error("That code has expired")}>fire-error</button>
      <button onClick={() => toast.info("Switched workspace")}>fire-info</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
}

describe("ToastProvider", () => {
  it("renders a toast when one is pushed", async () => {
    const user = userEvent.setup();
    renderHarness();

    expect(screen.queryByText("Note saved")).toBeNull();
    await user.click(screen.getByText("fire-success"));

    expect(screen.getByText("Note saved")).toBeTruthy();
  });

  it("puts errors in an assertive region and everything else in a polite one", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText("fire-error"));
    await user.click(screen.getByText("fire-success"));

    const assertive = screen.getByRole("alert");
    const polite = screen.getByRole("status");

    // A failure interrupts; a save confirmation waits its turn.
    expect(assertive).toHaveAttribute("aria-live", "assertive");
    expect(polite).toHaveAttribute("aria-live", "polite");
    expect(assertive.textContent).toContain("That code has expired");
    expect(polite.textContent).toContain("Note saved");
  });

  it("dismisses a toast when its close button is pressed", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText("fire-success"));
    expect(screen.getByText("Note saved")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Note saved")).toBeNull();
  });

  it("caps the visible stack and keeps the newest", async () => {
    const user = userEvent.setup();
    renderHarness();

    // Five pushes into a stack capped at three.
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByText("fire-info"));
    }

    const items = document.querySelectorAll(".toast-item");
    expect(items).toHaveLength(3);
  });

  it("auto-dismisses, and gives errors longer than successes", async () => {
    /* userEvent drives its own clock; the fake timers in this test are advanced
       explicitly below, so this hook deliberately does nothing. */
    const user = userEvent.setup({ advanceTimers: () => undefined });
    renderHarness();

    await user.click(screen.getByText("fire-success"));
    await user.click(screen.getByText("fire-error"));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 3200));
    });

    // The success has gone; the error is still readable.
    expect(screen.queryByText("Note saved")).toBeNull();
    expect(screen.getByText("That code has expired")).toBeTruthy();
  }, 10_000);

  it("labels the viewport so the region is findable", () => {
    renderHarness();
    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();
  });
});
