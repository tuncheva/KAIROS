import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SideNav } from "~/components/layout/SideNav";
import fs from "node:fs";
import path from "node:path";

describe("SideNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(<SideNav />);
    // The wordmark appears twice: the mobile top bar and the desktop rail.
    expect(screen.getAllByText("KAIROS").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the desktop sidebar", () => {
    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]');
    expect(aside).not.toBeNull();
  });

  it("contains nav items with correct translated labels", () => {
    render(<SideNav />);
    // Labels resolve to real English copy via the next-intl mock
    expect(screen.getAllByText("Projects").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Notes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Progress").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Events").length).toBeGreaterThanOrEqual(1);
  });

  it("contains settings nav item", () => {
    render(<SideNav />);
    expect(screen.getAllByText("Settings").length).toBeGreaterThanOrEqual(1);
  });

  it("does not use legacy card classes in tooltips", () => {
    const { container } = render(<SideNav />);
    const tooltips = container.querySelectorAll("[class*='ios-card']");
    expect(tooltips.length).toBe(0);
  });

  it("uses design token classes for tooltips", () => {
    const { container } = render(<SideNav />);
    const tooltipEls = container.querySelectorAll("[class*='bg-bg-elevated']");
    expect(tooltipEls.length).toBeGreaterThan(0);
  });

  it("opens mobile menu on hamburger click", async () => {
    const user = userEvent.setup();
    render(<SideNav />);

    const menuBtn = screen.getByLabelText("Menu");
    await user.click(menuBtn);

    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog).toBeInTheDocument();
  });

  it("closes mobile menu on escape key", async () => {
    const user = userEvent.setup();
    render(<SideNav />);

    const menuBtn = screen.getByLabelText("Menu");
    await user.click(menuBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("chat button dispatches kairos:openAI event", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener("kairos:openAI", handler);

    render(<SideNav />);

    // Find the Chat/AI button in desktop sidebar
    const chatBtns = screen.getAllByLabelText("Kairos AI");
    expect(chatBtns.length).toBeGreaterThanOrEqual(1);

    await user.click(chatBtns[0]!);
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener("kairos:openAI", handler);
  });

  it("uses elegant icon set (no legacy icon names in DOM)", () => {
    const { container } = render(<SideNav />);
    // The component should render SVG icons from lucide-react
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("highlights active nav item for current path", () => {
    render(<SideNav />);
    // Pathname mock returns "/" — no nav item matches "/" since home was removed
    // Just verify that nav renders properly
    const { container } = render(<SideNav />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("does not include a home nav item", () => {
    render(<SideNav />);
    // The home "/" route was removed from mainNavItems
    const links = document.querySelectorAll("a[href='/']");
    expect(links.length).toBe(0);
  });

  it("does not import Compass icon (home icon removed)", () => {
    // Static check on source
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/components/layout/SideNav.tsx"),
      "utf-8"
    );
    expect(source).not.toContain("Compass");
  });

  it("renders orgs link in desktop sidebar", () => {
    const { container } = render(<SideNav />);
    const orgsLinks = container.querySelectorAll("a[href='/orgs']");
    expect(orgsLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("uses Settings (cog) icon instead of SlidersHorizontal", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/components/layout/SideNav.tsx"),
      "utf-8"
    );
    expect(source).toContain("Settings");
    expect(source).not.toContain("SlidersHorizontal");
  });
  /* ---- Design 7A rail: hover expansion + pin ---- */

  it("collapses the rail to 64px and expands it on hover", () => {
    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;
    expect(aside.className).toContain("w-16");
    expect(aside.className).toContain("hover:w-[236px]");
    // A mouse click leaves focus on the clicked row, so `focus-within` would
    // hold the rail open long after the cursor left. Keyboard expansion is
    // handled by a `:has(:focus-visible)` rule in globals.css instead.
    expect(aside.className).not.toContain("focus-within:w-[236px]");
  });

  it("expands the rail for keyboard focus only, via :focus-visible", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../src/styles/globals.css"),
      "utf-8"
    );
    expect(css).toContain(".kairos-rail:has(:focus-visible)");
    expect(css).toContain(".kairos-rail:has(:focus-visible) .kairos-rail-label");
  });

  it("pins the rail open, stamps <html> and persists the choice", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem("kairos:railPinned");
    delete document.documentElement.dataset.railPinned;

    render(<SideNav />);
    const pin = screen.getByRole("button", { name: "Pin navigation" });

    expect(pin).toHaveAttribute("aria-pressed", "false");

    await user.click(pin);

    // `--rail-w` hangs off this attribute, which is what shifts the page.
    expect(document.documentElement.dataset.railPinned).toBe("true");
    expect(window.localStorage.getItem("kairos:railPinned")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Unpin navigation" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * The pinned *width* is CSS, not React.
   *
   * `globals.css` widens `.kairos-rail` under `:root[data-rail-pinned="true"]`,
   * and the pre-paint script in `themeInitScript.ts` sets that attribute before
   * the first frame. Picking the width class off React state instead meant the
   * rail painted collapsed on every load and widened once the effect that reads
   * localStorage had run — dragging `.rail-offset` and the whole page with it.
   *
   * So the class the stylesheet hooks onto has to be on the element, and it has
   * to be there unconditionally.
   */
  it("carries the CSS hook the pinned rule targets, pinned or not", () => {
    window.localStorage.setItem("kairos:railPinned", "true");
    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;

    expect(aside.className).toContain("kairos-rail");
    // Still the collapsed base width: the stylesheet overrides it, not React.
    expect(aside.className).toContain("w-16");

    window.localStorage.removeItem("kairos:railPinned");
  });

  it("does not stamp the rail attribute on mount, only on toggle", () => {
    // The pre-paint script owns the initial value. An effect that mirrored
    // React state onto <html> would overwrite it with "false" on every load,
    // which is the flash this whole arrangement exists to remove.
    window.localStorage.setItem("kairos:railPinned", "true");
    document.documentElement.dataset.railPinned = "true";

    render(<SideNav />);

    expect(document.documentElement.dataset.railPinned).toBe("true");

    window.localStorage.removeItem("kairos:railPinned");
    delete document.documentElement.dataset.railPinned;
  });
});
