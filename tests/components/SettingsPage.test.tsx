import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Settings page and settings components tests — verify white borders 
 * and legacy kairos-* classes have been removed, replaced with design tokens.
 */

const settingsPagePath = path.resolve(__dirname, "../../src/app/(app)/settings/page.tsx");
const settingsPageSource = fs.readFileSync(settingsPagePath, "utf-8");

const profilePath = path.resolve(__dirname, "../../src/components/settings/ProfileSettingsClient.tsx");
const profileSource = fs.readFileSync(profilePath, "utf-8");

const securityPath = path.resolve(__dirname, "../../src/components/settings/SecuritySettingsClient.tsx");
const securitySource = fs.readFileSync(securityPath, "utf-8");

const notificationsPath = path.resolve(__dirname, "../../src/components/settings/NotificationSettingsClient.tsx");
const notificationsSource = fs.readFileSync(notificationsPath, "utf-8");

const languagePath = path.resolve(__dirname, "../../src/components/settings/LanguageSettingsClient.tsx");
const languageSource = fs.readFileSync(languagePath, "utf-8");

const appearancePath = path.resolve(__dirname, "../../src/components/settings/AppearanceSettings.tsx");
const appearanceSource = fs.readFileSync(appearancePath, "utf-8");

const allSources = [
  { name: "SettingsPage", source: settingsPageSource },
  { name: "ProfileSettingsClient", source: profileSource },
  { name: "SecuritySettingsClient", source: securitySource },
  { name: "NotificationSettingsClient", source: notificationsSource },
  { name: "LanguageSettingsClient", source: languageSource },
  { name: "AppearanceSettings", source: appearanceSource },
];

describe("Settings Page – No White Borders", () => {
  it("header uses border-white/[0.06] instead of border-border-light", () => {
    expect(settingsPageSource).toContain("border-white/[0.06]");
    expect(settingsPageSource).not.toContain("border-border-light");
  });

  it("sidebar uses border-white/[0.06] instead of border-border-light/20", () => {
    expect(settingsPageSource).toContain("border-r border-slate-200 dark:border-white/[0.06]");
  });

  it("uses bg-bg-primary as base background (not bg-bg-secondary)", () => {
    expect(settingsPageSource).toContain('min-h-screen bg-bg-primary');
  });

  // The mobile settings *button* became a scrolling section nav in the TopBar
  // refactor (3c16a69); the border moved to its wrapper. What this guards is
  // still the same: a subtle token border, never border-border-light.
  it("mobile section nav uses subtle border", () => {
    expect(settingsPageSource).toContain("lg:hidden border-b border-slate-200 dark:border-white/[0.06]");
    expect(settingsPageSource).not.toContain("border-border-light");
  });
});

describe("Settings Components – No Legacy Classes", () => {
  for (const { name, source } of allSources) {
    describe(name, () => {
      it("does not use kairos-fg-primary", () => {
        expect(source).not.toContain("kairos-fg-primary");
      });

      it("does not use kairos-fg-secondary", () => {
        expect(source).not.toContain("kairos-fg-secondary");
      });

      it("does not use kairos-fg-tertiary", () => {
        expect(source).not.toContain("kairos-fg-tertiary");
      });

      it("does not use kairos-bg-surface", () => {
        expect(source).not.toContain("kairos-bg-surface");
      });

      it("does not use kairos-bg-tertiary", () => {
        expect(source).not.toContain("kairos-bg-tertiary");
      });

      it("does not use kairos-section-border", () => {
        expect(source).not.toContain("kairos-section-border");
      });

      it("does not use kairos-font-body", () => {
        expect(source).not.toContain("kairos-font-body");
      });

      it("does not use kairos-font-display", () => {
        expect(source).not.toContain("kairos-font-display");
      });

      it("does not use kairos-font-caption", () => {
        expect(source).not.toContain("kairos-font-caption");
      });

      it("does not use kairos-accent-primary", () => {
        expect(source).not.toContain("kairos-accent-primary");
      });

      it("does not use kairos-divider", () => {
        expect(source).not.toContain("kairos-divider");
      });
    });
  }
});

describe("Settings Components – Design Token Usage", () => {
  for (const { name, source } of allSources) {
    if (name === "SettingsPage") continue; // Page has minimal styling

    describe(name, () => {
      it("uses text-fg-primary for primary text", () => {
        expect(source).toContain("text-fg-primary");
      });

      it("uses bg-bg- design token backgrounds", () => {
        expect(source).toMatch(/bg-bg-(primary|secondary|tertiary|elevated)/);
      });
    });
  }
});
