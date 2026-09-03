import { describe, expect, it } from "vitest";

import { pickLocaleFromAcceptLanguage } from "~/i18n/acceptLanguage";
import { INCOMPLETE_LOCALES } from "~/i18n/locales";

describe("Accept-Language negotiation", () => {
  it("gives a Bulgarian browser Bulgarian", () => {
    expect(pickLocaleFromAcceptLanguage("bg-BG,bg;q=0.9,en;q=0.8")).toBe("bg");
  });

  it("matches on the primary subtag, not the exact tag", () => {
    expect(pickLocaleFromAcceptLanguage("bg-BG")).toBe("bg");
    expect(pickLocaleFromAcceptLanguage("en-GB")).toBe("en");
  });

  it("honours quality values over source order", () => {
    expect(pickLocaleFromAcceptLanguage("en;q=0.3,bg;q=0.9")).toBe("bg");
  });

  it("keeps source order when the qualities tie", () => {
    // Browsers list in preference order and often omit `q` on the first entry.
    expect(pickLocaleFromAcceptLanguage("bg,en")).toBe("bg");
    expect(pickLocaleFromAcceptLanguage("en,bg")).toBe("en");
  });

  it("ignores a language weighted to zero", () => {
    expect(pickLocaleFromAcceptLanguage("bg;q=0,en")).toBe("en");
  });

  it("never picks a locale that is not offered", () => {
    // `de`, `es` and `fr` have message files but are half-translated. Landing a
    // German speaker in a half-German interface is worse than English.
    for (const locale of INCOMPLETE_LOCALES) {
      expect(pickLocaleFromAcceptLanguage(`${locale}-DE,${locale};q=0.9`)).toBeNull();
    }
  });

  it("returns null when there is nothing to go on, so the caller's default wins", () => {
    expect(pickLocaleFromAcceptLanguage(null)).toBeNull();
    expect(pickLocaleFromAcceptLanguage("")).toBeNull();
    expect(pickLocaleFromAcceptLanguage("zz")).toBeNull();
  });

  it("treats a bare wildcard as no preference", () => {
    expect(pickLocaleFromAcceptLanguage("*")).toBe("en");
  });
});
