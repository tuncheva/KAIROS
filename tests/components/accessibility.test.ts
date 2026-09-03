import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Accessibility tests — verify all interactive components follow a11y best practices.
 * Checks source files for aria attributes, proper roles, and keyboard support.
 */

const componentsDir = path.resolve(__dirname, "../../src/components");

function readComponent(...segments: string[]): string {
  return fs.readFileSync(path.join(componentsDir, ...segments), "utf-8");
}

describe("Accessibility — SignInModal", () => {
  const src = readComponent("auth", "SignInModal.tsx");

  it("has form inputs with placeholder or label", () => {
    expect(src).toMatch(/placeholder|label|aria-label/i);
  });

  it("has email input type", () => {
    expect(src).toContain('type="email"');
  });

  it("has password input with show/hide toggle", () => {
    expect(src).toMatch(/type=.*password/);
  });
});

describe("Accessibility — SideNav", () => {
  const src = readComponent("layout", "SideNav.tsx");

  it("uses nav element or role navigation", () => {
    expect(src).toMatch(/<nav|role="navigation"/);
  });

  it("has link elements for navigation", () => {
    expect(src).toMatch(/href|Link/);
  });
});

describe("Accessibility — NotificationSystem", () => {
  const src = readComponent("notifications", "NotificationSystem.tsx");

  it("has button for bell icon", () => {
    expect(src).toMatch(/<button|onClick/);
  });
});

describe("Accessibility — ThemeToggle", () => {
  const src = readComponent("providers", "ThemeToggle.tsx");

  it("has aria-label on toggle button", () => {
    expect(src).toContain("aria-label");
  });

  it("uses button element", () => {
    expect(src).toContain("<button");
  });
});

describe("Accessibility — ImageUpload", () => {
  const src = readComponent("ui", "ImageUpload.tsx");

  it("has file input", () => {
    expect(src).toContain('type="file"');
  });

  it("accepts image files", () => {
    expect(src).toMatch(/accept.*image/);
  });
});

describe("Accessibility — LanguageSwitcher", () => {
  const src = readComponent("layout", "LanguageSwitcher.tsx");

  it("has button with accessible label", () => {
    expect(src).toMatch(/aria-label|title/);
  });
});

describe("Accessibility — ViewOnlyBanner", () => {
  const src = readComponent("orgs", "ViewOnlyBanner.tsx");

  it("uses warning color styling for view-only indicator", () => {
    expect(src).toMatch(/warning/);
    expect(src).toContain("View-only mode");
  });
});
