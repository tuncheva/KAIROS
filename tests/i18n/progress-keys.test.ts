import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * i18n progress keys.
 *
 * /progress is the record redesign: a contribution grid, a suggestions list,
 * the remaining workload and the all-time leaderboard. Every string it renders
 * lives under `progress.record`, and a locale missing one shows the reader a
 * MISSING_MESSAGE overlay rather than a label — so the list below is derived
 * from what the components actually call.
 */

const locales = ["en", "bg", "de", "es", "fr"];
const messagesDir = path.resolve(__dirname, "../../src/i18n/messages");
const componentsDir = path.resolve(__dirname, "../../src/components/progress");

/** Keys reached through a lookup table, which the source scan cannot see. */
const INDIRECT_KEYS = [
  "priorityUrgent",
  "priorityHigh",
  "priorityMedium",
  "priorityLow",
  "windowWeek",
  "windowMonth",
  "windowAll",
  "sinceWeek",
  "sinceMonth",
  "sinceAll",
];

/** `t("key")` calls in components bound to the `progress.record` namespace. */
function recordKeysUsedInSource(): string[] {
  const used = new Set(INDIRECT_KEYS);

  for (const file of fs.readdirSync(componentsDir)) {
    if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
    const source = fs.readFileSync(path.join(componentsDir, file), "utf-8");
    if (!source.includes('useTranslations("progress.record")')) continue;
    for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(match[1]!);
  }

  return Array.from(used).sort();
}

const usedKeys = recordKeysUsedInSource();

describe("i18n Progress Keys", () => {
  it("finds the keys the record components call", () => {
    expect(usedKeys.length).toBeGreaterThan(20);
  });

  for (const locale of locales) {
    describe(`${locale}.json`, () => {
      const raw = fs.readFileSync(path.join(messagesDir, `${locale}.json`), "utf-8");
      const messages = JSON.parse(raw) as Record<string, unknown>;
      const progress = messages.progress as Record<string, unknown>;

      it("has progress section", () => {
        expect(progress).toBeDefined();
        expect(typeof progress).toBe("object");
      });

      it("has a record section", () => {
        expect(progress.record).toBeDefined();
        expect(typeof progress.record).toBe("object");
      });

      it("translates every key the record renders", () => {
        const record = progress.record as Record<string, unknown>;
        const missing = usedKeys.filter((key) => {
          const value = record[key];
          return typeof value !== "string" || value.length === 0;
        });
        expect(missing).toEqual([]);
      });
    });
  }
});
