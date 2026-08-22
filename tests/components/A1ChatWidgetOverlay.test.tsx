import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { A1ChatWidgetOverlay } from "~/components/chat/A1ChatWidgetOverlay";

const push = vi.fn();
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({
    push,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

/** The widget panel is the fixed container that holds everything. */
function getPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-testid='ai-widget-panel']");
}

describe("A1ChatWidgetOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    push.mockClear();
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

  it("shows minimise, full screen, and close buttons in header", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    expect(screen.getByLabelText("Minimise")).toBeInTheDocument();
    expect(screen.getByLabelText("Open full screen")).toBeInTheDocument();
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
      expect(panel?.style.height).toBe("46px");
    });
  });

  it("navigates to the full page instead of stretching the panel", async () => {
    const user = userEvent.setup();
    render(<A1ChatWidgetOverlay isOpen />);

    await user.click(screen.getByLabelText("Open full screen"));

    expect(push).toHaveBeenCalledWith("/chat/ai");
    // The panel keeps its size on the way out. Growing it first would flash a
    // full-screen widget over the page the user is leaving.
    expect(getPanel()?.style.width).not.toBe("100vw");
  });

  it("closes itself when it hands over to the full page", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<A1ChatWidgetOverlay isOpen onOpenChange={onOpenChange} />);

    await user.click(screen.getByLabelText("Open full screen"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
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

  it("hides resize indicator when minimised", async () => {
    const user = userEvent.setup();
    render(<A1ChatWidgetOverlay isOpen />);

    await user.click(screen.getByLabelText("Minimise"));

    const indicators = document.querySelectorAll(".pointer-events-none svg");
    expect(indicators.length).toBe(0);
  });

  it("supports drag via pointer events on header", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    const header = document.querySelector("[class*='cursor-grab']");
    expect(header).toBeInTheDocument();
    expect(header?.className).toContain("cursor-grab");
  });

  it("renders as a rounded panel", () => {
    render(<A1ChatWidgetOverlay isOpen />);

    const panel = getPanel();
    expect(panel?.className).toContain("rounded-");
  });
});
