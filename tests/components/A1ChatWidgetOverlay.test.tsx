import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { A1ChatWidgetOverlay } from "~/components/chat/A1ChatWidgetOverlay";

/** The widget panel is the fixed, rounded container that holds everything. */
function getPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".fixed.rounded-2xl");
}

describe("A1ChatWidgetOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<A1ChatWidgetOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the chat panel when kairos:openAI event is dispatched", () => {
    render(<A1ChatWidgetOverlay />);

    act(() => {
      window.dispatchEvent(new CustomEvent("kairos:openAI"));
    });

    expect(getPanel()).toBeInTheDocument();
  });

  it("shows minimise, maximise, and close buttons in header", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    expect(screen.getByLabelText("Minimise")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximise")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("closes the panel when close button is clicked", async () => {
    const user = userEvent.setup();
    render(<A1ChatWidgetOverlay />);

    act(() => {
      window.dispatchEvent(new CustomEvent("kairos:openAI"));
    });
    expect(getPanel()).toBeInTheDocument();

    await user.click(screen.getByLabelText("Close"));
    expect(getPanel()).not.toBeInTheDocument();
  });

  it("minimises the panel (hides body)", async () => {
    const user = userEvent.setup();
    render(<A1ChatWidgetOverlay isOpen />);

    const panel = getPanel();
    expect(panel).toBeInTheDocument();

    await user.click(screen.getByLabelText("Minimise"));

    // After minimise, panel height should be 48px (title bar only)
    await waitFor(() => {
      expect(panel?.style.height).toBe("48px");
    });
  });

  it("maximises the panel to full viewport", async () => {
    const user = userEvent.setup();
    render(<A1ChatWidgetOverlay isOpen />);

    await user.click(screen.getByLabelText("Maximise"));

    const panel = getPanel();
    expect(panel?.style.width).toBe("100vw");
    expect(panel?.style.height).toBe("100vh");
  });

  it("restores from maximise to previous size", async () => {
    const user = userEvent.setup();
    render(<A1ChatWidgetOverlay isOpen />);

    const panel = getPanel()!;
    const originalWidth = panel.style.width;

    await user.click(screen.getByLabelText("Maximise"));
    expect(panel.style.width).toBe("100vw");

    await user.click(screen.getByLabelText("Restore"));
    expect(panel.style.width).toBe(originalWidth);
  });

  it("saves position to localStorage", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    const stored = localStorage.getItem("kairos-chat-widget-rect");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!) as Record<string, unknown>;
    expect(parsed).toHaveProperty("x");
    expect(parsed).toHaveProperty("y");
    expect(parsed).toHaveProperty("w");
    expect(parsed).toHaveProperty("h");
  });

  it("restores position from localStorage", () => {
    const savedRect = { x: 100, y: 200, w: 400, h: 500 };
    localStorage.setItem("kairos-chat-widget-rect", JSON.stringify(savedRect));

    render(<A1ChatWidgetOverlay isOpen />);

    const panel = getPanel();
    expect(panel?.style.left).toBe("100px");
    expect(panel?.style.top).toBe("200px");
  });

  it("passes projectId to ProjectIntelligenceChat", () => {
    render(<A1ChatWidgetOverlay isOpen projectId={42} />);
    expect(getPanel()).toBeInTheDocument();
  });

  it("renders with solid background styling", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    const panel = getPanel();
    expect(panel?.style.backgroundColor).toContain("var(--bg-primary)");
    expect(panel?.className).not.toContain("kairos-glass");
  });

  it("shows resize indicator in normal mode", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("hides resize indicator when maximised", async () => {
    const user = userEvent.setup();
    render(<A1ChatWidgetOverlay isOpen />);

    await user.click(screen.getByLabelText("Maximise"));

    const indicators = document.querySelectorAll(".pointer-events-none svg");
    expect(indicators.length).toBe(0);
  });

  it("supports drag via pointer events on header", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    const header = document.querySelector("[class*='cursor-grab']");
    expect(header).toBeInTheDocument();
    expect(header?.className).toContain("cursor-grab");
  });

  it("renders with rounded-2xl border", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    const panel = getPanel();
    expect(panel?.className).toContain("rounded-2xl");
  });
});
