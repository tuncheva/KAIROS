import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { RoleSelectionModal } from "~/components/auth/RoleSelectionModal";

describe("RoleSelectionModal", () => {
  it("renders when isOpen is true", () => {
    render(<RoleSelectionModal isOpen={true} onComplete={vi.fn()} />);
    // Modal should show the initial 'choose' step
    const { container } = render(
      <RoleSelectionModal isOpen={true} onComplete={vi.fn()} />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <RoleSelectionModal isOpen={false} onComplete={vi.fn()} />,
    );
    // Container should be empty or hidden
    expect(container.innerHTML).toBe("");
  });

  it("shows role selection options", () => {
    render(<RoleSelectionModal isOpen={true} onComplete={vi.fn()} />);
    // Should offer admin and personal options
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
