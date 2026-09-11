import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import type { AbstractIntlMessages } from 'next-intl';
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './locales';
import { pickLocaleFromAcceptLanguage } from './acceptLanguage';

// Re-exported so existing server-side importers keep working; client components
// should import from `~/i18n/locales` directly.
export * from './locales';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();

  // The cookie is client-controlled, so it is validated rather than cast. Passing
  // an unrecognised string through to next-intl used to leave it reporting a
  // locale it had no messages for: the import below failed, the catch loaded
  // English, and `locale` still claimed to be whatever the cookie said — so
  // date and number formatting followed a locale the copy did not.
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;

  /* Cookie first — it is an explicit choice, and it must beat the browser's
     standing preference or the switcher would not stick. `Accept-Language`
     only decides the *first* visit, which is exactly the visit that used to
     land a Bulgarian speaker in English on a Bulgarian-market product. */
  const locale: Locale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : pickLocaleFromAcceptLanguage((await headers()).get('accept-language')) ??
      DEFAULT_LOCALE;

  /* English is always loaded as the base, and the active locale is overlaid on
     top of it key by key.

     The fallback used to be per *file*: load `de.json`, and only if that import
     threw fall back to English wholesale. That covers a missing or corrupt file
     and nothing else. But `de`, `es` and `fr` carry roughly 1100 of the ~2380
     keys `en` and `bg` do, and their imports succeed — so every key added since
     they were last translated resolved to nothing, and next-intl renders a
     missing key as the key path itself. A German speaker saw
     `dashboard.widgets.overdueTasks.title` in the UI.

     Merging per key means an untranslated string degrades to English, which is
     the normal expectation for a partially translated product. It also makes
     shipping a locale at 40% a deliberate, survivable choice rather than a
     visible break, so new copy can land without blocking on five translations. */
  const base = (await import(`./messages/${DEFAULT_LOCALE}.json`)) as {
    default: AbstractIntlMessages;
  };

  let messages: AbstractIntlMessages = base.default;

  if (locale !== DEFAULT_LOCALE) {
    try {
      const active = (await import(`./messages/${locale}.json`)) as {
        default: AbstractIntlMessages;
      };
      messages = deepMerge(base.default, active.default);
    } catch {
      // Missing or unparseable file: English alone is already correct.
    }
  }

  return {
    locale,
    messages
  };
});

/**
 * Overlay `override` onto `base`, recursing into nested message objects.
 *
 * Only plain objects are merged; anything else (a string, or a value whose type
 * disagrees between the two files) is taken from `override` when present. An
 * empty string counts as absent, because that is how the translation files spell
 * "not translated yet" — taking it literally would render a blank label, which
 * is strictly worse than showing English.
 */
function deepMerge(
  base: AbstractIntlMessages,
  override: AbstractIntlMessages,
): AbstractIntlMessages {
  const merged: AbstractIntlMessages = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];

    if (isMessageObject(value) && isMessageObject(existing)) {
      merged[key] = deepMerge(existing, value);
      continue;
    }

    if (value === "" || value === undefined) continue;

    merged[key] = value;
  }

  return merged;
}

function isMessageObject(value: unknown): value is AbstractIntlMessages {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
