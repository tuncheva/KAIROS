import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gsap } from "gsap";
import { HomeClient } from "~/components/homepage/HomeClient";

/* HomeClient composes the landing sections; GSAP is mocked in setup.ts */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
}));

describe("HomeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the main content wrapper with the landing palette scope", () => {
    render(<HomeClient />);
    const main = document.getElementById("main-content");
    expect(main?.tagName).toBe("MAIN");
    expect(main?.className).toContain("dark");
    expect(main?.className).toContain("k-landing");
    expect(main?.className).toContain("bg-bg-primary");
    expect(main?.className).not.toContain("bg-gradient-to-br");
  });

  it("renders the three masked hero headline lines", () => {
    render(<HomeClient />);
    const lines = [...document.querySelectorAll("[data-hero-line]")].map((l) => l.textContent);
    expect(lines).toEqual(["Everything", "in its right", "moment."]);
    expect(document.querySelectorAll("[data-hero-line] > .k-in-line").length).toBe(3);
  });

  it("renders the hero subline", () => {
    render(<HomeClient />);
    expect(screen.getByText(/one quiet place/)).toBeInTheDocument();
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

  it("does not paint the retired drifting background circles", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll(".k-drift-slow, .k-drift-slower").length).toBe(0);
  });

  it("marks sections for scroll reveal", () => {
    render(<HomeClient />);
    expect(document.querySelectorAll("[data-reveal]").length).toBeGreaterThanOrEqual(6);
    // The project progress bar draws in from its left edge.
    expect(document.querySelectorAll("[data-reveal-rule]").length).toBe(1);
  });

  it("renders the assistant replay as an illustration with no dead controls", () => {
    render(<HomeClient />);
    const panel = screen.getByRole("figure", { name: "Kairos assistant" });
    expect(panel).toHaveTextContent("Approve plan");
    expect(panel.querySelectorAll("button, a, input").length).toBe(0);
  });

  it("renders the five agents", () => {
    render(<HomeClient />);
    const names = [...document.querySelectorAll("#agents li .font-display")].map((n) => n.textContent);
    expect(names).toEqual([
      "Mentor",
      "Odysseus",
      "Mnemosyne",
      "Iris",
      "Hemera",
    ]);
  });

  it("renders the sample team roster with roles", () => {
    render(<HomeClient />);
    const team = document.getElementById("teams");
    expect(team).toHaveTextContent("Maria");
    expect(team).toHaveTextContent("Moderator");
    expect(team).toHaveTextContent("68% done");
  });

  it("renders the sample event card", () => {
    render(<HomeClient />);
    expect(screen.getByText("Spring launch evening")).toBeInTheDocument();
  });

  it("renders the footer with copyright", () => {
    render(<HomeClient />);
    const year = new Date().getFullYear().toString();
    expect(
      screen.getByText((text) => text.includes(year) && text.includes("Kairos")),
    ).toBeInTheDocument();
  });

  it("shows the uppercase wordmark beside a bare logo mark in the header", () => {
    render(<HomeClient />);
    const header = document.querySelector("header");
    expect(header?.textContent).toContain("KAIROS");
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

    await user.click(screen.getByText("Agents", { selector: "header a" }));

    const scrollTween = vi.mocked(gsap.to).mock.calls.find(
      ([target, vars]) => target === window && (vars as { scrollTo?: unknown }).scrollTo,
    );
    expect(scrollTween).toBeDefined();
    expect(window.location.hash).toBe("#agents");
  });

  it("keeps every top-nav item an in-page anchor, so none reload the page", () => {
    render(<HomeClient />);
    const hrefs = [...document.querySelectorAll("header nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#agents", "#teams", "#events", "#footer"]);
    for (const href of hrefs) {
      expect(document.getElementById(href!.slice(1))).toBeInTheDocument();
    }
  });

  it("points the hero's access-code link at the join field", () => {
    render(<HomeClient />);
    expect(screen.getByText("I have an access code").getAttribute("href")).toBe("#join");
    expect(document.querySelector("form#join input")).toBeInTheDocument();
  });

  it("parks a typed access code behind sign-in on the join route", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);

    const join = screen.getByRole("button", { name: "Join" });
    expect(join).toBeDisabled();

    await user.type(screen.getByLabelText("Access code"), "k7m·42q");
    await user.click(join);

    expect(replace).toHaveBeenCalledWith(
      `/?callbackUrl=${encodeURIComponent("/join/K7M42Q")}`,
      { scroll: false },
    );
  });

  it("renders a create-workspace CTA in the hero and the closing section", () => {
    render(<HomeClient />);
    expect(screen.getAllByText("Create your workspace").length).toBe(2);
  });

  it("shows the kairos logo image in header and footer", () => {
    render(<HomeClient />);
    // Decorative beside the wordmark, so the images carry an empty alt.
    expect(document.querySelectorAll('img[src*="logo_white"]').length).toBe(2);
  });
});
