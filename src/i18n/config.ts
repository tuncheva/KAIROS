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

  let messages: AbstractIntlMessages = {};
  try {
    const messagesModule = await import(`./messages/${locale}.json`) as { default: AbstractIntlMessages };
    messages = messagesModule.default;
  } catch {
    const fallbackModule = await import(`./messages/${DEFAULT_LOCALE}.json`) as { default: AbstractIntlMessages };
    messages = fallbackModule.default;
  }

  return {
    locale,
    messages
  };
});
