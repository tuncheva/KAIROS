import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OnboardingSheet, openOnboarding } from "~/components/onboarding/OnboardingSheet";

describe("OnboardingSheet", () => {
  it("opens via the kairos:openOnboarding event and renders the tabs", async () => {
    render(<OnboardingSheet />);
    // Not open by default
    expect(screen.queryByRole("dialog")).toBeNull();

    openOnboarding();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // Getting-started content (the heading, not the tab button)
    expect(
      screen.getByRole("heading", { name: "Getting started" }),
    ).toBeInTheDocument();
    // A step item
    expect(screen.getByText(/dashboard greets you each day/)).toBeInTheDocument();
  });

  it("switches to the FAQ tab and shows questions", async () => {
    render(<OnboardingSheet />);
    openOnboarding();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "FAQ" }));
    expect(screen.getByText("What is Kairos for?")).toBeInTheDocument();
  });

  it("switches to the Contact tab", async () => {
    render(<OnboardingSheet />);
    openOnboarding();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Contact" }));
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("dismisses on close", async () => {
    render(<OnboardingSheet />);
    openOnboarding();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("applies the exit class while closing, before unmounting", async () => {
    render(<OnboardingSheet />);
    openOnboarding();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Close" }));

    // The sheet stays mounted long enough to play its exit animation, so the
    // `--out` class must be on the dialog (and scrim) during that window.
    await waitFor(() =>
      expect(screen.getByRole("dialog").className).toContain("onboarding-sheet-dialog--out"),
    );
    expect(screen.queryByRole("dialog")?.className).toContain("onboarding-sheet-dialog--out");
  });
});
