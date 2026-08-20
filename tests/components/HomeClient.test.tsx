import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gsap } from "gsap";
import { HomeClient } from "~/components/homepage/HomeClient";

/* HomeClient composes the landing sections; GSAP is mocked in setup.ts */

describe("HomeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(<HomeClient />);
    expect(screen.getAllByText("Kairos").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the main content wrapper with correct role", () => {
    render(<HomeClient />);
    const main = document.getElementById("main-content");
    expect(main).toBeInTheDocument();
    expect(main?.tagName).toBe("MAIN");
  });

  it("renders the three masked hero headline lines", () => {
    render(<HomeClient />);
    expect(screen.getByText("The right moment,")).toBeInTheDocument();
    expect(screen.getByText("engineered.")).toBeInTheDocument();
    expect(screen.getByText("Not hoped for.")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-hero-line]").length).toBe(3);
  });

  it("renders the hero subline", () => {
    render(<HomeClient />);
    expect(screen.getByText(/one workspace for coordinating teams/)).toBeInTheDocument();
  });

  it("renders one language switcher (header only)", () => {
    render(<HomeClient />);
    expect(screen.getAllByLabelText("Switch language").length).toBe(1);
  });

  it("renders both header auth buttons", () => {
    render(<HomeClient />);
    expect(screen.getByText("Log in")).toBeInTheDocument();
    expect(screen.getByText("Start free")).toBeInTheDocument();
  });

  it("renders two drifting background circles, not the retired four", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll(".fc-1, .fc-2, .fc-3, .fc-4").length).toBe(0);
    expect(document.querySelectorAll(".k-drift-slow, .k-drift-slower").length).toBe(2);
  });

  it("marks sections for scroll reveal", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll("[data-reveal]").length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll("[data-reveal-rule]").length).toBeGreaterThanOrEqual(1);
  });

  it("opens the sign in modal from a CTA", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);

    await user.click(screen.getByText("Create your workspace"));

    // The modal owns its own copy; its presence is what the CTA is wired to.
    expect(document.querySelectorAll("[data-hero-line]").length).toBe(3);
  });

  it("renders the three workspace panels", () => {
    render(<HomeClient />);
    // "Organizations"/"Teams" also appear as footer links, so match the panel
    // headings specifically.
    const headings = [...document.querySelectorAll(".k-card h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Organizations", "Teams", "Personal goals"]);
  });

  it("renders the four why-teams rows", () => {
    render(<HomeClient />);
    expect(screen.getByText("One workflow")).toBeInTheDocument();
    expect(screen.getByText("Pages worth sharing")).toBeInTheDocument();
    expect(screen.getByText("Secure by default")).toBeInTheDocument();
    expect(screen.getByText("Timing you can see")).toBeInTheDocument();
    expect(document.querySelectorAll(".k-row").length).toBe(4);
  });

  it("renders the four product strip frames", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll("figure").length).toBe(4);
    expect(screen.getByText("01 · Interactive timeline")).toBeInTheDocument();
  });

  it("renders the how-it-works steps", () => {
    render(<HomeClient />);
    expect(screen.getByText("Open a space")).toBeInTheDocument();
    expect(screen.getByText("Run the work")).toBeInTheDocument();
    expect(screen.getByText("Publish it")).toBeInTheDocument();
  });

  it("renders the footer with copyright", () => {
    render(<HomeClient />);
    const year = new Date().getFullYear().toString();
    expect(
      screen.getByText((text) => text.includes(year) && text.includes("Kairos")),
    ).toBeInTheDocument();
  });

  it("renders the three workspace cards with no sticky highlight state", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll(".k-card").length).toBe(3);
    // The accent is hover-only, so nothing carries a persistent lit flag.
    expect(document.querySelectorAll(".k-card[data-on]").length).toBe(0);
  });

  it("renders the read-progress rail in the header", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll("header .k-prog").length).toBe(1);
  });

  it("renders the statement marquee as two identical looping halves", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll(".k-marquee-track").length).toBe(1);
    expect(screen.getAllByText("timing.").length).toBe(6);
  });

  it("labels the product strip frames as placeholders", () => {
    render(<HomeClient />);
    expect(screen.getByText(/drop real product screenshots here/)).toBeInTheDocument();
  });

  it("shows the uppercase wordmark beside a bare logo mark in the header", () => {
    render(<HomeClient />);
    const header = document.querySelector("header");
    expect(header?.textContent).toContain("KAIROS");
    // The logo is no longer boxed in a gradient tile.
    expect(header?.querySelectorAll("[class*=linear-gradient]").length).toBe(0);
  });

  it("runs the header edge to edge rather than capping it mid-screen", () => {
    render(<HomeClient />);
    const bar = document.querySelector("header > div");
    expect(bar?.className).not.toContain("max-w-");
  });

  it("scrolls in-page nav links to their section instead of jumping", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);

    await user.click(screen.getByText("Workspaces", { selector: "a" }));

    // The click is handled here — a tween to the section, not a browser jump.
    const scrollTween = vi.mocked(gsap.to).mock.calls.find(
      ([target, vars]) => target === window && (vars as { scrollTo?: unknown }).scrollTo,
    );
    expect(scrollTween).toBeDefined();
    expect(window.location.hash).toBe("#workspaces");
  });

  it("keeps every top-nav item an in-page anchor, so none reload the page", () => {
    render(<HomeClient />);
    const hrefs = [...document.querySelectorAll("header nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#workspaces", "#product", "#why", "#footer"]);
    expect(document.getElementById("footer")).toBeInTheDocument();
  });

  it("renders the final CTA", () => {
    render(<HomeClient />);
    expect(screen.getByText("Get started")).toBeInTheDocument();
  });

  it("uses the flat dark canvas, not the retired gradient", () => {
    render(<HomeClient />);
    const main = document.getElementById("main-content");
    expect(main?.className).toContain("bg-bg-primary");
    expect(main?.className).not.toContain("bg-gradient-to-br");
  });

  it("shows the kairos logo image in header and footer", () => {
    render(<HomeClient />);
    // Decorative beside the wordmark, so the images carry an empty alt.
    expect(document.querySelectorAll('img[src*="logo_white"]').length).toBe(2);
  });
});
