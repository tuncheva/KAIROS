/**
 * One definition of "what language does this user speak" for the whole agent tier.
 *
 * These constants used to live in `a1ContextBuilder`, which meant A1 was the only
 * agent that could reach them — and it showed. A1 replied in the language it was
 * asked in across five locales; A2, A3 and A4 carried their own hardcoded
 * "English and Bulgarian only, refuse everything else" block and had no idea what
 * the user's saved language even was.
 *
 * `a1ContextBuilder` re-exports `SupportedLocale` and `LOCALE_NAMES` so existing
 * importers keep working.
 */

import { eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { users } from "~/server/db/schema";

/**
 * The locales KAIROS ships message files for, and the only values the
 * `language` enum on `user` accepts.
 *
 * This bounds the *interface* and the reply fallback. It does not bound what the
 * agents will answer in: a message in a language that is not on this list still
 * gets an answer in that language. See `languageRule`.
 */
export type SupportedLocale = "en" | "bg" | "es" | "fr" | "de";

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  bg: "Bulgarian (български)",
  es: "Spanish (español)",
  fr: "French (français)",
  de: "German (Deutsch)",
};

export const DEFAULT_AGENT_LOCALE: SupportedLocale = "en";

/**
 * The user's saved interface language, or English.
 *
 * Never throws. The column is `notNull` with a default, but a stale session
 * against a pre-migration database should degrade to English rather than fail the
 * whole turn — a reply in the wrong language beats no reply.
 */
export async function resolveUserLocale(
  ctx: TRPCContext,
  userId: string,
): Promise<SupportedLocale> {
  const row = await ctx.db
    .select({ language: users.language })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
    .catch(() => null);

  return row?.language ?? DEFAULT_AGENT_LOCALE;
}

/**
 * A string the *server* puts in front of the user, in the locales we have it in.
 *
 * Almost everything the agents say is written by the model, which now mirrors the
 * user's language. A handful of strings are injected by this server instead —
 * fallbacks for when the model produced a plan the code had to override — and
 * those were hardcoded English, so a Bulgarian conversation would end on an
 * English sentence.
 *
 * `en` is required because it is the fallback: `es`, `fr` and `de` are not
 * complete interface locales either (see `src/i18n/locales.ts`), so a user on one
 * of those gets English here exactly as they do in the UI. Add a key when a
 * translation lands.
 */
export type LocalizedText = Partial<Record<SupportedLocale, string>> & {
  en: string;
};

export function localized(
  text: LocalizedText,
  locale: SupportedLocale,
): string {
  return text[locale] ?? text.en;
}
