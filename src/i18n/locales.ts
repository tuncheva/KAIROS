/**
 * Locale constants, split out from `./config` so client components can import
 * them. `./config` also imports `next/headers`, which cannot cross into a
 * client bundle — importing the locale list from there pulled the whole
 * request-config module along with it and broke the build.
 */
/**
 * Locales offered to users.
 *
 * ## Why this list is shorter than the message files
 *
 * `de`, `es` and `fr` have 478 of ~992 keys — roughly half the interface. They
 * were declared as supported and offered in the language switcher anyway, so
 * choosing one produced a screen half in that language and half in English, with
 * no indication anything was missing.
 *
 * The message files are still here and still loadable; they are simply not
 * offered. Finishing a translation is a one-line change: move the locale from
 * `INCOMPLETE_LOCALES` to `locales`. `tests/i18n/translations.test.ts` asserts key
 * parity across everything in `locales`, so a locale cannot be promoted while it
 * still has gaps — the suite fails first.
 */
export const locales = ['en', 'bg'] as const;

/**
 * Locales with message files that are too incomplete to offer.
 *
 * Kept as a named export rather than deleted so the gap is visible in code and the
 * files do not look orphaned.
 */
export const INCOMPLETE_LOCALES = ['de', 'es', 'fr'] as const;

export type Locale = (typeof locales)[number];
export type IncompleteLocale = (typeof INCOMPLETE_LOCALES)[number];

/** Every locale that has a message file, complete or not. */
export const LOCALES_WITH_MESSAGES = [...locales, ...INCOMPLETE_LOCALES] as const;

/**
 * Display metadata for the locales on offer.
 *
 * Single source of truth: `LanguageSwitcher` and `LanguageSettingsClient` both
 * built their own copy of this list, which is how all five stayed on offer after
 * the coverage problem was known.
 */
export const LOCALE_METADATA: Record<Locale, { name: string; flag: string }> = {
  en: { name: 'English', flag: '🇬🇧' },
  bg: { name: 'Български', flag: '🇧🇬' },
};

export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
