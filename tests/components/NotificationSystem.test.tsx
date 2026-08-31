import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationSystem } from "~/components/notifications/NotificationSystem";

/**
 * P1-20. The bell is the one component visible on nearly every page, and it was
 * entirely hardcoded English in a product with exact bg key parity everywhere
 * else. These cover the parts of that fix that are assertable without a live
 * socket: the copy comes from the catalogue, and the panel can be operated and
 * escaped from a keyboard.
 */
describe("NotificationSystem — localization and a11y", () => {
  it("takes its copy from the catalogue, not from literals", async () => {
    const user = userEvent.setup();
    render(<NotificationSystem />);

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    // Resolved through the real en.json by the next-intl mock in tests/setup.
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText("Nothing waiting")).toBeTruthy();
    expect(screen.getByText("New activity lands here first.")).toBeTruthy();
    expect(screen.getByText("Notification settings")).toBeTruthy();
  });

  it("announces the popup relationship on the bell", () => {
    render(<NotificationSystem />);
    const bell = screen.getByRole("button", { name: "Notifications" });

    expect(bell).toHaveAttribute("aria-haspopup", "dialog");
    expect(bell).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and hands focus back to the bell", async () => {
    const user = userEvent.setup();
    render(<NotificationSystem />);
    const bell = screen.getByRole("button", { name: "Notifications" });

    await user.click(bell);
    expect(screen.queryByRole("dialog")).toBeTruthy();
    expect(bell).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");

    // Escape used to do nothing here, so a keyboard user had no way out.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bell).toHaveFocus();
  });
});

describe("NotificationSystem", () => {
  it("renders without crashing", () => {
    const { container } = render(<NotificationSystem />);
    expect(container).toBeTruthy();
  });

  it("renders bell icon button", () => {
    render(<NotificationSystem />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("does not show notification count when no data", () => {
    const { container } = render(<NotificationSystem />);
    // With null data from mocked tRPC, no unread badge should appear
    const badge = container.querySelector('[data-testid="unread-count"]');
    expect(badge).toBeNull();
  });
});
