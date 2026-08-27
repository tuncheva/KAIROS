import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Source guards for /settings.
 *
 * The page is a ledger now: the shell in `SettingsWorkspace` and the row, group
 * and control primitives in `ledger/Ledger`, with each section supplying data
 * rather than markup. So the checks that used to grep every section for
 * `text-fg-primary` would now pass or fail on where the styling happens to live,
 * which is not what they were protecting. What they were protecting is the rule
 * that survived the rewrite: no legacy `kairos-*` utilities, and no hardcoded
 * colours — every surface goes through a `bg-*` / `fg-*` / `border-*` token, or
 * light mode and the six accent themes break.
 */

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../src", relative), "utf-8");

const settingsPageSource = read("app/(app)/settings/page.tsx");
const ledgerSource = read("components/settings/ledger/Ledger.tsx");

const allSources = [
  { name: "SettingsPage", source: settingsPageSource },
  { name: "SettingsWorkspace", source: read("components/settings/SettingsWorkspace.tsx") },
  { name: "Ledger", source: ledgerSource },
  { name: "ProfileSettingsClient", source: read("components/settings/ProfileSettingsClient.tsx") },
  { name: "WorkspaceSettingsClient", source: read("components/settings/WorkspaceSettingsClient.tsx") },
  { name: "SecuritySettingsClient", source: read("components/settings/SecuritySettingsClient.tsx") },
  { name: "NotificationSettingsClient", source: read("components/settings/NotificationSettingsClient.tsx") },
  { name: "LanguageSettingsClient", source: read("components/settings/LanguageSettingsClient.tsx") },
  { name: "AppearanceSettings", source: read("components/settings/AppearanceSettings.tsx") },
  { name: "AiSettingsClient", source: read("components/settings/AiSettingsClient.tsx") },
  { name: "DeveloperSettingsClient", source: read("components/settings/DeveloperSettingsClient.tsx") },
];

const LEGACY_CLASSES = [
  "kairos-fg-primary",
  "kairos-fg-secondary",
  "kairos-fg-tertiary",
  "kairos-bg-surface",
  "kairos-bg-tertiary",
  "kairos-section-border",
  "kairos-font-body",
  "kairos-font-display",
  "kairos-font-caption",
  "kairos-accent-primary",
  "kairos-divider",
];

describe("Settings page shell", () => {
  it("uses bg-bg-primary as its base background", () => {
    expect(settingsPageSource).toContain("bg-bg-primary");
  });

  it("stays a server component that delegates to the client workspace", () => {
    expect(settingsPageSource).toContain("SettingsWorkspace");
  });

  it("keeps the section in the URL, so a settings link is shareable", () => {
    expect(settingsPageSource).toContain("searchParams");
    expect(settingsPageSource).toContain("isSettingsSection");
  });
});

describe("Settings components", () => {
  for (const { name, source } of allSources) {
    describe(name, () => {
      for (const legacy of LEGACY_CLASSES) {
        it(`does not use ${legacy}`, () => {
          expect(source).not.toContain(legacy);
        });
      }

      it("does not hardcode white-alpha borders", () => {
        expect(source).not.toContain("border-white/[");
      });

      it("does not hardcode palette colours", () => {
        // Tailwind's own palette bypasses the theme entirely: a `text-red-400`
        // is the same red in light mode, and a `slate-200` border does not move
        // with the accent. `text-error` and `border-border-light` do.
        expect(source).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|red|green|blue|purple|amber)-\d{2,3}\b/);
      });

      it("does not hardcode hex colours", () => {
        expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      });
    });
  }
});

describe("Ledger primitives", () => {
  it("style the rows, so sections stay declarative", () => {
    expect(ledgerSource).toContain("text-fg-primary");
    expect(ledgerSource).toMatch(/border-border-(light|medium|strong)/);
  });

  it("separate rows with a hairline rather than wrapping each in a card", () => {
    expect(ledgerSource).toContain("border-t border-border-light");
  });
});
