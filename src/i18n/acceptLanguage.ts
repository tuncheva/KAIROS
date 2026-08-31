import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "./locales";

/**
 * Picks a locale from an `Accept-Language` header.
 *
 * Without this, `~/i18n/config` read only the `NEXT_LOCALE` cookie and fell
 * back to English — so a Bulgarian visitor to a Bulgarian-market product,
 * arriving for the first time with no cookie set, landed in English and had to
 * find the switcher to get the language their browser had already asked for.
 *
 * Deliberately small. It reads quality values and matches on the primary
 * subtag, so `bg-BG` selects `bg`, and it never invents a locale that is not
 * on the offered list — an incomplete translation is worse than English.
 */
export function pickLocaleFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      if (!tag) return null;

      const q = params
        .map((p) => /^\s*q=([\d.]+)\s*$/i.exec(p))
        .find(Boolean)?.[1];

      const quality = q === undefined ? 1 : Number(q);
      if (!Number.isFinite(quality) || quality <= 0) return null;

      /* `index` breaks ties. Browsers list in preference order and often omit
         `q` on the first entry, so sorting by quality alone would reorder
         equally-weighted tags arbitrarily. */
      return { tag: tag.trim().toLowerCase(), quality, index };
    })
    .filter((x): x is { tag: string; quality: number; index: number } => x !== null)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const { tag } of ranked) {
    // `*` means "anything", which is not a preference worth acting on.
    if (tag === "*") return DEFAULT_LOCALE;

    const primary = tag.split("-")[0];
    if (isSupportedLocale(primary)) return primary;
  }

  return null;
}
