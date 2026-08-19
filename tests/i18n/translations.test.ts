import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * i18n translation tests — verify all locale files have
 * the required keys and are valid JSON.
 */

const localesDir = path.resolve(__dirname, "../../src/i18n/messages");
const locales = ["en", "bg", "es", "fr", "de"] as const;

function loadLocale(locale: string): Record<string, unknown> {
  const filePath = path.join(localesDir, `${locale}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Expected keys in the "home" section — the landing page copy.
 *
 * Kept in step with `src/components/homepage/`: the redesign replaced the old
 * hero/bento strings wholesale, so a stale entry here is the signal that a
 * section was renamed without its translations following.
 */
const requiredHomeKeys = [
  "title",
  "navWorkspaces",
  "navProduct",
  "navWhyKairos",
  "navAbout",
  "logIn",
  "startFree",
  "getStarted",
  "heroTagline",
  "heroLine1",
  "heroLine2",
  "heroLine3",
  "heroSubline",
  "heroPrimaryCta",
  "heroSecondaryCta",
  "marqueePlan",
  "marqueeCollaborate",
  "marqueePublish",
  "marqueeTiming",
  "wsLabel",
  "wsHeading",
  "wsBody",
  "wsOrgTitle",
  "wsOrgBody",
  "wsTeamTitle",
  "wsTeamBody",
  "wsPersonalTitle",
  "wsPersonalBody",
  "stripLabel",
  "stripHeading",
  "stripScrollHint",
  "stripTimeline",
  "stripBoard",
  "stripEventPage",
  "stripRsvp",
  "howLabel",
  "howOpenTitle",
  "howOpenBody",
  "howRunTitle",
  "howRunBody",
  "howPublishTitle",
  "howPublishBody",
  "whyLabel",
  "whyOneWorkflowTitle",
  "whyOneWorkflowBody",
  "whyPagesTitle",
  "whyPagesBody",
  "whySecureTitle",
  "whySecureBody",
  "whyTimingTitle",
  "whyTimingBody",
  "statLanguages",
  "statWorkspaceTypes",
  "statRoleLevels",
  "statOnePlace",
  "quoteBody",
  "quoteAttribution",
  "finalHeading",
  "finalHeadingAccent",
  "finalSubline",
  "footerTagline",
  "footerProduct",
  "footerCompany",
  "footerLegal",
  "footerOrganizations",
  "footerTeams",
  "footerEvents",
  "footerTimelines",
  "footerAbout",
  "footerContact",
  "footerCareers",
  "footerPrivacy",
  "footerTerms",
  "footerSecurity",
];

describe("i18n locale files", () => {
  for (const locale of locales) {
    describe(`${locale}.json`, () => {
      let data: Record<string, unknown>;

      it("is valid JSON", () => {
        const filePath = path.join(localesDir, `${locale}.json`);
        const raw = fs.readFileSync(filePath, "utf-8");
        expect(() => JSON.parse(raw) as unknown).not.toThrow();
        data = JSON.parse(raw) as Record<string, unknown>;
      });

      it("has a 'home' section", () => {
        data = loadLocale(locale);
        expect(data).toHaveProperty("home");
        expect(typeof data.home).toBe("object");
      });

      for (const key of requiredHomeKeys) {
        it(`home.${key} exists and is a non-empty string`, () => {
          data = loadLocale(locale);
          const home = data.home as Record<string, unknown>;
          expect(home).toHaveProperty(key);
          expect(typeof home[key]).toBe("string");
          expect((home[key] as string).length).toBeGreaterThan(0);
        });
      }

      it("all home values are strings (no nested objects)", () => {
        data = loadLocale(locale);
        const home = data.home as Record<string, unknown>;
        for (const [k, v] of Object.entries(home)) {
          expect(typeof v).toBe("string");
          if (typeof v !== "string") {
            throw new Error(`home.${k} in ${locale}.json is not a string`);
          }
        }
      });
    });
  }

  describe("Cross-locale consistency", () => {
    it("all locales have the same home keys", () => {
      const enHome = loadLocale("en").home as Record<string, unknown>;
      const enKeys = Object.keys(enHome).sort();

      for (const locale of locales) {
        if (locale === "en") continue;
        const localeHome = loadLocale(locale).home as Record<string, unknown>;
        const localeKeys = Object.keys(localeHome).sort();
        expect(localeKeys).toEqual(enKeys);
      }
    });

    it("no locale has empty string values in home", () => {
      for (const locale of locales) {
        const home = loadLocale(locale).home as Record<string, unknown>;
        for (const [k, v] of Object.entries(home)) {
          expect((v as string).trim().length).toBeGreaterThan(0);
          if ((v as string).trim().length === 0) {
            throw new Error(`home.${k} in ${locale}.json is empty`);
          }
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Key parity across offered locales
// ---------------------------------------------------------------------------

/**
 * Audit finding #23: `de`, `es` and `fr` had 478 of ~992 keys — about half the
 * interface — while all five locales were declared supported and offered in the
 * language switcher. Nothing failed, so nobody noticed.
 *
 * These tests assert parity for the locales that are actually *offered*
 * (`locales` in `src/i18n/locales.ts`). That makes the gate self-maintaining: a
 * locale cannot be promoted back onto the offered list while it still has holes,
 * because this suite fails first. The incomplete files stay in the repo and are
 * reported on rather than asserted against.
 */

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

// Read the offered list out of the source rather than importing it: this test
// file is plain Node and the surrounding i18n modules pull in next-intl APIs.
const localesSource = fs.readFileSync(
  path.resolve(__dirname, "../../src/i18n/locales.ts"),
  "utf-8",
);

function parseLocaleList(name: string): string[] {
  // Substring slicing rather than a regex: the declaration is a plain array
  // literal, and this avoids escaping brackets inside a template string.
  const at = localesSource.indexOf(name);
  if (at === -1) throw new Error(`could not find ${name} in i18n locales`);

  const open = localesSource.indexOf("[", at);
  const close = localesSource.indexOf("]", open);
  if (open === -1 || close === -1) {
    throw new Error(`could not parse ${name} from i18n locales`);
  }

  const body = localesSource.slice(open + 1, close);
  return [...body.matchAll(/['"]([a-z]{2})['"]/g)].map((m) => m[1]!);
}

const offeredLocales = parseLocaleList("export const locales");
const incompleteLocales = parseLocaleList("export const INCOMPLETE_LOCALES");

describe("offered locales", () => {
  it("offers at least English", () => {
    expect(offeredLocales).toContain("en");
  });

  it("does not offer a locale that is also marked incomplete", () => {
    const both = offeredLocales.filter((l) => incompleteLocales.includes(l));
    expect(both).toEqual([]);
  });

  it("has a message file for every offered locale", () => {
    for (const locale of offeredLocales) {
      expect(
        fs.existsSync(path.join(localesDir, `${locale}.json`)),
        `missing messages for offered locale "${locale}"`,
      ).toBe(true);
    }
  });

  it("has full key parity with English for every offered locale", () => {
    const englishKeys = flattenKeys(loadLocale("en")).sort();

    for (const locale of offeredLocales) {
      if (locale === "en") continue;

      const localeKeys = new Set(flattenKeys(loadLocale(locale)));
      const missing = englishKeys.filter((k) => !localeKeys.has(k));

      expect(
        missing,
        `"${locale}" is offered but missing ${missing.length} keys, e.g. ${missing
          .slice(0, 5)
          .join(", ")}`,
      ).toEqual([]);
    }
  });

  it("has no keys that English lacks, in any offered locale", () => {
    // The other direction: a stale key left behind after an English rename would
    // otherwise sit untranslatable and unused forever.
    const englishKeys = new Set(flattenKeys(loadLocale("en")));

    for (const locale of offeredLocales) {
      if (locale === "en") continue;
      const extra = flattenKeys(loadLocale(locale)).filter((k) => !englishKeys.has(k));
      expect(extra, `"${locale}" has keys English does not: ${extra.join(", ")}`).toEqual([]);
    }
  });
});

describe("incomplete locales", () => {
  it("keeps its message files loadable, so promoting one is a config change", () => {
    for (const locale of incompleteLocales) {
      expect(() => loadLocale(locale)).not.toThrow();
    }
  });

  it("is genuinely incomplete — otherwise it should be promoted", () => {
    const englishKeys = flattenKeys(loadLocale("en"));

    for (const locale of incompleteLocales) {
      const localeKeys = new Set(flattenKeys(loadLocale(locale)));
      const missing = englishKeys.filter((k) => !localeKeys.has(k));

      expect(
        missing.length,
        `"${locale}" now has every key — move it from INCOMPLETE_LOCALES to locales`,
      ).toBeGreaterThan(0);
    }
  });
});
