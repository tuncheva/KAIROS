import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { Modal } from "~/components/ui/Modal";
import { Overlay } from "~/components/ui/Overlay";

/**
 * Portalled dialogs keep the palette of the page they opened from.
 *
 * `Modal` and `Overlay` render into `document.body`, outside the edition
 * wrapper (`.settings-elegant`, `.calendar-refined`…) that remaps the semantic
 * tokens. Without `EditionScope` a settings confirm or the calendar drawer fell
 * back to the classic cool palette and the bright accent.
 */

const editionOf = (el: HTMLElement) =>
  el.closest(".settings-elegant, .calendar-refined, .tui-refined");

describe("EditionScope", () => {
  it("carries the caller's edition into a Modal's portal", () => {
    render(
      <div className="settings-elegant">
        <Modal label="Rename" onDismiss={vi.fn()}>
          <p>inside</p>
        </Modal>
      </div>,
    );
    const dialog = screen.getByRole("dialog");
    const scope = editionOf(dialog);
    expect(scope).not.toBeNull();
    expect(scope).toHaveClass("contents", "settings-elegant");
    // The scope is in the portal on <body>, not the caller's own wrapper.
    expect(scope?.parentElement).toBe(document.body);
  });

  it("carries the edition into an Overlay's portal", () => {
    render(
      <div className="calendar-refined">
        <Overlay>
          <div data-testid="drawer" />
        </Overlay>
      </div>,
    );
    expect(editionOf(screen.getByTestId("drawer"))).toHaveClass(
      "calendar-refined",
    );
  });

  it("adds no edition on a classic page", () => {
    render(
      <div>
        <Modal label="Plain" onDismiss={vi.fn()}>
          <p>inside</p>
        </Modal>
      </div>,
    );
    expect(editionOf(screen.getByRole("dialog"))).toBeNull();
  });
});
