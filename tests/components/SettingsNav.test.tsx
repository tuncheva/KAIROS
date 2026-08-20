import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsNav } from "~/components/layout/SettingsNav";

describe("SettingsNav", () => {
  const sections = [
    { id: "profile", label: "Profile" },
    { id: "workspace", label: "Workspace" },
    { id: "notifications", label: "Notifications" },
    { id: "security", label: "Security" },
    { id: "language", label: "Language" },
    { id: "appearance", label: "Appearance" },
  ];

  it("renders without crashing", () => {
    render(<SettingsNav activeSection="profile" />);
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders all settings sections", () => {
    render(<SettingsNav activeSection="profile" />);
    for (const section of sections) {
      expect(screen.getByText(section.label)).toBeInTheDocument();
    }
  });

  it("highlights the active section", () => {
    const { container } = render(<SettingsNav activeSection="security" />);
    const activeLink = container.querySelector('[aria-current="page"]');
    expect(activeLink).not.toBeNull();
    expect(activeLink?.textContent).toContain("Security");
  });

  it("does not use kairos-* legacy classes", () => {
    const { container } = render(<SettingsNav activeSection="profile" />);
    const html = container.innerHTML;
    expect(html).not.toContain("kairos-");
  });

  it("does not use legacy card classes", () => {
    const { container } = render(<SettingsNav activeSection="profile" />);
    const html = container.innerHTML;
    expect(html).not.toContain("ios-card");
  });

  it("uses subtle border separators between items", () => {
    const { container } = render(<SettingsNav activeSection="profile" />);
    const separators = container.querySelectorAll("[class*='border-white']");
    expect(separators.length).toBeGreaterThan(0);
  });

  it("shows active indicator dot for selected section", () => {
    const { container } = render(<SettingsNav activeSection="profile" />);
    const activeDots = container.querySelectorAll("[class*='bg-accent-primary']");
    // At least one dot for the active section
    expect(activeDots.length).toBeGreaterThanOrEqual(1);
  });

  it("icon containers have rounded-lg styling", () => {
    const { container } = render(<SettingsNav activeSection="profile" />);
    const iconContainers = container.querySelectorAll("[class*='rounded-lg']");
    expect(iconContainers.length).toBeGreaterThanOrEqual(sections.length);
  });

  it("each section links to correct settings URL", () => {
    render(<SettingsNav activeSection="profile" />);
    for (const section of sections) {
      const link = screen.getByText(section.label).closest("a");
      expect(link?.getAttribute("href")).toBe(`/settings?section=${section.id}`);
    }
  });

  it("only one section is marked as active at a time", () => {
    const { container } = render(<SettingsNav activeSection="language" />);
    const activeLinks = container.querySelectorAll('[aria-current="page"]');
    expect(activeLinks.length).toBe(1);
  });
});
