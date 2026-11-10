import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    // Once in the bar (sm and up) and once inside the phone menu.
    expect(screen.getAllByRole("button", { name: "Log in" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Start free" })).toHaveLength(2);
    expect(document.querySelector("#landing-menu")).toHaveTextContent("Start free");
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

  it("renders the agent roster as tabs, conversational first, then scheduled", () => {
    render(<HomeClient />);
    const lists = screen.getAllByRole("tablist");
    expect(lists.map((l) => l.getAttribute("aria-labelledby"))).toEqual([
      "agents-group-live",
      "agents-group-clock",
    ]);
    const names = screen.getAllByRole("tab").map((tab) => tab.querySelector(".font-display")?.textContent);
    expect(names).toEqual(["Mentor", "Odysseus", "Mnemosyne", "Iris", "Solon", "Hemera", "Argus"]);
    expect(screen.getByRole("tab", { name: /Mentor/ })).toHaveAttribute("aria-selected", "true");
  });

  it("switches the agent replay on click and with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("What needs my attention this week?");

    await user.click(screen.getByRole("tab", { name: /Odysseus/ }));
    expect(panel).toHaveTextContent("launch-brief.pdf");
    expect(panel).toHaveAttribute("aria-labelledby", "agent-tab-task_planner");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: /Mnemosyne/ })).toHaveFocus();
    expect(panel).toHaveTextContent("locked notes never reach me");

    await user.keyboard("{End}");
    expect(panel).toHaveTextContent("database query, not a model");
  });

  it("tells a change as four steps, each one a button", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);
    const how = document.getElementById("how")!;
    const steps = within(how).getAllByRole("button");
    ["Ask", "Draft", "Approve", "Apply"].forEach((title, i) => expect(steps[i]).toHaveTextContent(title));
    expect(steps).toHaveLength(4);
    expect(within(how).getByText("Step 1 of 4")).toBeInTheDocument();
    expect(steps[0]).toHaveAttribute("aria-current", "step");

    // With motion the buttons scroll the pinned track; the step follows scroll.
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await user.click(steps[2]!);
    expect(scrollTo).toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it("lets the moderator permissions be switched", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);
    const remove = screen.getByRole("switch", { name: "Delete projects" });
    expect(remove).toHaveAttribute("aria-checked", "false");
    await user.click(remove);
    expect(remove).toHaveAttribute("aria-checked", "true");
  });

  it("locks the private note and hides its text from a reader", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);
    const lock = screen.getByRole("button", { name: "Lock" });
    await user.click(lock);
    expect(screen.getByRole("button", { name: "Unlock" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/the note’s text is encrypted/)).toBeInTheDocument();
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
    const events = document.getElementById("events")!;
    expect(within(events).getByText("Spring launch evening")).toBeInTheDocument();
    expect(events).toHaveTextContent("24 going");
  });

  it("counts a visitor in when they RSVP going, and out again", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);
    const events = document.getElementById("events")!;
    const going = within(events).getByRole("button", { name: "Going" });

    // The count rolls like the app's own figures: mid-roll the outgoing digit is
    // still in the DOM (hidden), and the value is announced by its label.
    await user.click(going);
    expect(going).toHaveAttribute("aria-pressed", "true");
    expect(within(events).getByLabelText("25")).toBeInTheDocument();

    await user.click(within(events).getByRole("button", { name: "Maybe" }));
    expect(going).toHaveAttribute("aria-pressed", "false");
    expect(within(events).getByLabelText("24")).toBeInTheDocument();
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

  it("pins the header and opens a menu below lg", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);
    const header = document.querySelector("header")!;
    expect(header.className).toContain("fixed");
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  });

  it("runs the header edge to edge rather than capping it mid-screen", () => {
    render(<HomeClient />);
    const bar = document.querySelector("header > div");
    expect(bar?.className).not.toContain("max-w-");
  });

  it("scrolls in-page nav links to their section instead of jumping", async () => {
    const user = userEvent.setup();
    render(<HomeClient />);

    await user.click(screen.getByText("Agents", { selector: "header nav a" }));

    const scrollTween = vi.mocked(gsap.to).mock.calls.find(
      ([target, vars]) => target === window && (vars as { scrollTo?: unknown }).scrollTo,
    );
    expect(scrollTween).toBeDefined();
    expect(window.location.hash).toBe("#agents");
  });

  it("keeps every top-nav item an in-page anchor, so none reload the page", () => {
    render(<HomeClient />);
    const hrefs = [...document.querySelectorAll("header nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#how", "#agents", "#teams", "#events"]);
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
