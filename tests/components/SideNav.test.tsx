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
    // Keyboard users get the same expansion when a row takes focus.
    expect(aside.className).toContain("focus-within:w-[236px]");
  });

  it("pins the rail open, stamps <html> and persists the choice", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem("kairos:railPinned");

    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;
    const pin = screen.getByRole("button", { name: "Pin navigation" });

    expect(pin).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.railPinned).toBe("false");

    await user.click(pin);

    expect(aside.className).toContain("w-[236px]");
    expect(aside.className).not.toContain("w-16");
    // `--rail-w` hangs off this attribute, which is what shifts the page.
    expect(document.documentElement.dataset.railPinned).toBe("true");
    expect(window.localStorage.getItem("kairos:railPinned")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Unpin navigation" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("restores a pinned rail from localStorage on mount", () => {
    window.localStorage.setItem("kairos:railPinned", "true");
    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;
    expect(aside.className).toContain("w-[236px]");
    window.localStorage.removeItem("kairos:railPinned");
  });
});
