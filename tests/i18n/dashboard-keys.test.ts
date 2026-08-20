import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The dashboard is the post-login landing page, so a key missing from one locale
 * is the first thing that user sees. This pins every locale to the same shape as
 * `en`, including the nested activity/health/status groups.
 */

const localesDir = path.resolve(__dirname, "../../src/i18n/messages");
const locales = ["en", "bg", "es", "fr", "de"] as const;

function load(locale: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(localesDir, `${locale}.json`), "utf-8")) as Record<
    string,
    unknown
  >;
}

/** Flattened dotted key paths, so nested groups are compared too. */
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

const reference = paths((load("en") as { dashboard: unknown }).dashboard).sort();

describe("i18n dashboard keys", () => {
  it("has keys to compare", () => {
    expect(reference.length).toBeGreaterThan(30);
  });

  for (const locale of locales) {
    it(`${locale}.json carries nav.dashboard`, () => {
      const nav = load(locale).nav as Record<string, unknown>;
      expect(typeof nav.dashboard).toBe("string");
      expect((nav.dashboard as string).length).toBeGreaterThan(0);
    });

    it(`${locale}.json has exactly the dashboard keys en has`, () => {
      const data = load(locale) as { dashboard?: unknown };
      expect(data.dashboard).toBeTruthy();
      expect(paths(data.dashboard).sort()).toEqual(reference);
    });

    it(`${locale}.json keeps the placeholders each message needs`, () => {
      const dashboard = (load(locale) as { dashboard: Record<string, unknown> }).dashboard;
      const greeting = dashboard.greeting as Record<string, string>;
      for (const part of ["morning", "afternoon", "evening"]) {
        expect(greeting[part]).toContain("{name}");
      }

      const summary = dashboard.summary as string;
      for (const token of ["{due,", "{overdue,", "{projects,"]) {
        expect(summary).toContain(token);
      }

      const actions = (dashboard.activity as { actions: Record<string, string> }).actions;
      for (const message of Object.values(actions)) {
        expect(message).toContain("{user}");
        expect(message).toContain("{task}");
        expect(message).toContain("{project}");
      }
    });
  }
});
