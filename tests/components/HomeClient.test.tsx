import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    const headings = [...document.querySelectorAll(".k-panel h3")].map((h) => h.textContent);
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

  it("renders the hero tagline pill", () => {
    render(<HomeClient />);
    expect(screen.getByText(/Plan · Collaborate · Publish/)).toBeInTheDocument();
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
