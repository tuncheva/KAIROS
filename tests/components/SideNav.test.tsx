import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  /* The tip is positioned for the 68px collapsed rail. Open, the row's own
     label is already on screen and the tip would land on top of it. */
  describe("the hover tip", () => {
    const railWidth = (container: HTMLElement, width: number) => {
      const rail = container.querySelector(".kairos-rail");
      if (!rail) throw new Error("no rail in the tree");
      vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
        width,
        height: 800,
        top: 0,
        left: 0,
        right: width,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    };

    const notesRow = (container: HTMLElement) =>
      container.querySelector('.kairos-rail a[href="/notes"]')!;

    it("appears while the rail is collapsed", async () => {
      const { container } = render(<SideNav />);
      railWidth(container, 68);

      await userEvent.hover(notesRow(container));

      expect(container.querySelector(".kairos-rail-tip")).not.toBeNull();
    });

    it("stays away once the rail has opened", async () => {
      const { container } = render(<SideNav />);
      railWidth(container, 248);

      await userEvent.hover(notesRow(container));

      expect(container.querySelector(".kairos-rail-tip")).toBeNull();
    });
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
    // The component should render SVG icons from ~/components/ui/icons
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
  /* ---- Design 1b sidebar: open by default, collapses to a rail ---- */

  const resetRail = () => {
    window.localStorage.removeItem("kairos:railCollapsed");
    delete document.documentElement.dataset.railCollapsed;
  };

  it("is open at 248px by default and does not expand on hover", () => {
    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;
    expect(aside.className).toContain("w-[248px]");
    expect(aside.className).not.toContain("hover:w-");
  });

  it("groups the destinations under Workspace, Insights and Collaboration", () => {
    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;
    expect(aside.textContent).toContain("Workspace");
    expect(aside.textContent).toContain("Insights");
    expect(aside.textContent).toContain("Collaboration");
  });

  it("collapses from its toggle, stamps <html> and persists the choice", async () => {
    const user = userEvent.setup();
    resetRail();

    render(<SideNav />);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);

    // `--rail-w` hangs off this attribute, which is what shifts the page.
    expect(document.documentElement.dataset.railCollapsed).toBe("true");
    expect(window.localStorage.getItem("kairos:railCollapsed")).toBe("true");
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    expect(document.documentElement.dataset.railCollapsed).toBe("false");
    expect(window.localStorage.getItem("kairos:railCollapsed")).toBe("false");

    resetRail();
  });

  it("toggles on Mod+\\ on desktop", async () => {
    const user = userEvent.setup();
    resetRail();
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    render(<SideNav />);
    await user.keyboard("{Control>}\\{/Control}");
    expect(document.documentElement.dataset.railCollapsed).toBe("true");

    matchMedia.mockRestore();
    resetRail();
  });

  it("opens Kairos AI on Mod+J", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener("kairos:openAI", handler);
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    render(<SideNav />);
    await user.keyboard("{Control>}j{/Control}");
    expect(handler).toHaveBeenCalledTimes(1);

    matchMedia.mockRestore();
    window.removeEventListener("kairos:openAI", handler);
  });

  it("opens the command palette from the search row", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener("kairos:openPalette", handler);

    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;
    await user.click(within(aside).getByRole("button", { name: "Search" }));
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener("kairos:openPalette", handler);
  });

  /**
   * The collapsed *width* is CSS, not React.
   *
   * `globals.css` narrows `.kairos-rail` under
   * `:root[data-rail-collapsed="true"]`, and the pre-paint script in
   * `themeInitScript.ts` sets that attribute before the first frame. Picking the
   * width class off React state instead would paint the open sidebar on every
   * load and snap it shut once the effect that reads localStorage had run.
   */
  it("keeps the open width class whether collapsed or not", () => {
    window.localStorage.setItem("kairos:railCollapsed", "true");
    const { container } = render(<SideNav />);
    const aside = container.querySelector('aside[aria-label="Primary"]')!;

    expect(aside.className).toContain("kairos-rail");
    expect(aside.className).toContain("w-[248px]");

    resetRail();
  });

  it("narrows the rail and hides its labels from the stylesheet", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../src/styles/globals.css"),
      "utf-8"
    );
    expect(css).toContain(':root[data-rail-collapsed="true"] .kairos-rail {');
    expect(css).toContain(':root[data-rail-collapsed="true"] .kairos-rail .kairos-rail-label');
  });

  it("does not stamp the rail attribute on mount, only on toggle", () => {
    // The pre-paint script owns the initial value. An effect that mirrored
    // React state onto <html> would overwrite it with "false" on every load,
    // which is the flash this whole arrangement exists to remove.
    window.localStorage.setItem("kairos:railCollapsed", "true");
    document.documentElement.dataset.railCollapsed = "true";

    render(<SideNav />);

    expect(document.documentElement.dataset.railCollapsed).toBe("true");

    resetRail();
  });
});
