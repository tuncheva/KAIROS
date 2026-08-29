/**
 * Deterministic reply-language selection.
 *
 * ## Why this exists
 *
 * The reply language used to be decided entirely inside the system prompt: a
 * `## Language` section told the model to mirror the user, and a pair of
 * heuristics (`wantsBulgarianGuidance`, `wantsLocaleFallback`) tried to keep
 * Bulgarian words out of the prompt on turns where Bulgarian was not in play.
 *
 * It kept failing the same way — an English message answered in Bulgarian —
 * for two reasons no amount of prompt wording could fix:
 *
 * 1. Both heuristics were overridden at every call site with
 *    `|| context.locale === "bg"`. A user whose saved interface language is
 *    Bulgarian therefore got the full Bulgarian block — Cyrillic examples, a
 *    line shouting `CRITICAL: ... you MUST answer entirely in Bulgarian` — in
 *    front of an English message. The gate existed; it was wired shut.
 * 2. Cyrillic sat outside the gate anyway: A1's off-topic refusal carried its
 *    own Bulgarian translation, and A2/A3/A4 each carried a Bulgarian example
 *    summary. Those were unconditional, so the "no Cyrillic on Latin turns"
 *    property the gate was written to guarantee never actually held.
 *
 * ## What replaces it
 *
 * The server decides the language, not the model. `detectReplyLanguage` reads
 * the user's own words and returns a decision; `replyLanguageDirective` turns
 * that decision into one short system message appended *last*, after the
 * conversation history and immediately before the user's message, where it
 * competes with nothing and gets the recency the earlier rules never had.
 *
 * Detection is deliberately narrow. It answers "which of a handful of common
 * languages is this, and what script is it in" and says nothing otherwise — at
 * which point the directive falls back to "mirror the message", which the model
 * does well on its own. The part that matters is the negative constraint: a
 * message with no Cyrillic in it pins the answer away from Cyrillic whether or
 * not the language itself was identified.
 */

import {
  DEFAULT_AGENT_LOCALE,
  LOCALE_NAMES,
  type SupportedLocale,
} from "~/server/llm/locale";
import { languageAnchorMessages } from "~/server/llm/prompts/languageRules";

export type ReplyScript = "cyrillic" | "latin" | "other" | "none";

export interface ReplyLanguage {
  /** BCP-47-ish code, or `null` when detection could not name a language. */
  code: string | null;
  /** English name of the language, or `null` when it could not be named. */
  name: string | null;
  /** Dominant script of the user's words. `none` means no letters at all. */
  script: ReplyScript;
  /** How the decision was reached — surfaced in logs and tests. */
  source: "message" | "saved-locale";
}

/** Names for the languages the detector can actually name. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  bg: "Bulgarian",
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  ro: "Romanian",
};

/**
 * Function words, scored by how many of a message's tokens they cover.
 *
 * Short lists on purpose: these are the words it is hard to write a sentence
 * without, so a two- or three-word message still scores. Words shared across
 * several of these languages ("no", "la", "come") are left out — they add noise
 * without adding separation.
 */
const STOPWORDS: Record<string, readonly string[]> = {
  en: [
    "the", "is", "are", "what", "how", "my", "you", "of", "to", "and", "for",
    "in", "on", "this", "that", "can", "do", "does", "with", "have", "was",
    "were", "which", "who", "when", "where", "why", "please", "thanks",
    "thank", "hello", "hi", "hey", "show", "give", "me", "it", "not", "any",
    "should", "about", "status", "tasks", "project",
  ],
  bg: [
    "и", "на", "за", "да", "се", "не", "ли", "как", "какво", "кога", "къде",
    "защо", "аз", "ти", "той", "тя", "ние", "вие", "те", "този", "тази",
    "това", "тези", "моите", "моя", "здравей", "здравейте", "благодаря",
    "моля", "покажи", "дай", "искам", "трябва", "проект", "задача", "бележка",
    "събитие", "проекта", "задачи",
  ],
  ru: [
    "что", "как", "это", "мой", "меня", "вы", "они", "который", "почему",
    "здравствуйте", "спасибо", "пожалуйста", "нет", "мне", "есть", "был",
    "была", "были", "очень", "ещё", "уже", "или", "проекта", "задачи",
  ],
  es: [
    "el", "los", "las", "un", "una", "que", "de", "en", "por", "para", "con",
    "es", "son", "cómo", "qué", "cuándo", "dónde", "mis", "mi", "hola",
    "gracias", "muéstrame", "tengo", "hay", "del", "al",
  ],
  fr: [
    "le", "les", "un", "une", "des", "est", "sont", "que", "qui", "quoi",
    "comment", "quand", "où", "pourquoi", "je", "vous", "mes", "mon", "ma",
    "bonjour", "merci", "dans", "pour", "avec", "sur", "du", "au",
  ],
  de: [
    "der", "die", "das", "ein", "eine", "ist", "sind", "was", "wie", "wann",
    "wo", "warum", "ich", "sie", "mein", "meine", "hallo", "danke", "bitte",
    "zeig", "und", "nicht", "mit", "für", "auf", "von", "haben", "kann",
  ],
  it: [
    "il", "lo", "gli", "un", "una", "che", "di", "per", "con", "sono", "come",
    "quando", "dove", "perché", "io", "miei", "mio", "ciao", "grazie",
    "mostrami", "del", "nel", "sul",
  ],
  pt: [
    "os", "as", "um", "uma", "que", "de", "em", "por", "para", "com", "é",
    "são", "como", "quando", "onde", "porquê", "eu", "meus", "meu", "olá",
    "obrigado", "obrigada", "mostre", "do", "da", "no", "na",
  ],
  nl: [
    "de", "het", "een", "is", "zijn", "wat", "hoe", "wanneer", "waar",
    "waarom", "ik", "jij", "mijn", "hallo", "bedankt", "alsjeblieft", "laat",
    "zien", "en", "niet", "met", "voor", "op", "van",
  ],
  pl: [
    "jest", "są", "co", "jak", "kiedy", "gdzie", "dlaczego", "moje", "mój",
    "cześć", "dziękuję", "proszę", "pokaż", "nie", "tak", "dla", "przez",
    "który", "która",
  ],
  tr: [
    "ne", "nasıl", "nerede", "neden", "benim", "merhaba", "teşekkürler",
    "lütfen", "göster", "var", "yok", "için", "ile", "bir", "bu", "şu",
  ],
  ro: [
    "este", "sunt", "ce", "cum", "când", "unde", "meu", "mele", "salut",
    "mulțumesc", "arată", "pentru", "cu", "din", "și",
  ],
};

/**
 * Letters only one of the two Cyrillic candidates uses.
 *
 * Bulgarian and Russian share most of the alphabet, so the split comes down to
 * the few characters that do not overlap: `ы`, `э` and `ё` do not exist in
 * Bulgarian at all.
 */
const RUSSIAN_ONLY = /[ыэё]/i;

/** Anything that is not the user's prose: urls, code, ids, mentions, hashes. */
const NOISE =
  /(```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|<[^>]+>|[\w.+-]+@[\w.-]+|#\d+|\b[0-9a-f]{8,}\b)/gi;

const ANY_LETTER = /\p{L}/u;
const CYRILLIC_LETTER = /\p{Script=Cyrillic}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

function stripNoise(text: string): string {
  return text.replace(NOISE, " ");
}

/**
 * Which script the message is mostly written in.
 *
 * Counts letters rather than looking for a single match, so one Latin project
 * name inside a Bulgarian sentence — or one Cyrillic name inside an English
 * one — does not decide the script.
 */
function dominantScript(text: string): ReplyScript {
  let cyrillic = 0;
  let latin = 0;
  let other = 0;

  for (const char of text) {
    if (!ANY_LETTER.test(char)) continue;
    if (CYRILLIC_LETTER.test(char)) cyrillic += 1;
    else if (LATIN_LETTER.test(char)) latin += 1;
    else other += 1;
  }

  if (cyrillic + latin + other === 0) return "none";
  if (other > cyrillic && other > latin) return "other";
  return cyrillic > latin ? "cyrillic" : "latin";
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * The best-scoring language among `candidates`, or `null` if nothing scored.
 *
 * One stopword hit is enough to name a language — "hi" and "здравей" are each a
 * single token — but only among candidates of the right script, so a hit can
 * never pick a language the message could not have been written in.
 */
function scoreLanguages(
  tokens: readonly string[],
  candidates: readonly string[],
): string | null {
  let best: string | null = null;
  let bestScore = 0;

  for (const code of candidates) {
    const words = new Set(STOPWORDS[code] ?? []);
    let score = 0;
    for (const token of tokens) if (words.has(token)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  }

  return bestScore > 0 ? best : null;
}

const LATIN_CANDIDATES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "pl",
  "tr",
  "ro",
] as const;

/**
 * Which language the reply must be written in this turn.
 *
 * Pass every string the user actually wrote — the message, and on the handoff
 * path the original message behind another agent's paraphrase. The paraphrase
 * itself must not be passed: it is written by A1, and normalizing it to English
 * is exactly the failure this guards against.
 *
 * `savedLocale` is used only when the words contain no letter at all (a bare
 * id, an emoji, a button press). It is never a preference over a message that
 * can be read.
 */
export function detectReplyLanguage(
  savedLocale: SupportedLocale = DEFAULT_AGENT_LOCALE,
  ...userText: Array<string | undefined | null>
): ReplyLanguage {
  const text = stripNoise(
    userText
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .join("\n"),
  );

  const script = dominantScript(text);

  if (script === "none") {
    return {
      code: savedLocale,
      // The native-script gloss in `LOCALE_NAMES.bg` is dropped: this string
      // goes into the prompt, and putting Cyrillic in front of the model is the
      // thing that made it answer in Cyrillic.
      name: LOCALE_NAMES[savedLocale].split(" (")[0] ?? savedLocale,
      script,
      source: "saved-locale",
    };
  }

  const tokens = tokenize(text);

  if (script === "cyrillic") {
    // Bulgarian is the default for Cyrillic: it is the Cyrillic language KAIROS
    // ships an interface for, and Russian markers are the exception worth
    // testing for rather than the other way round.
    // The letter check comes first, not as a tiebreaker: `ы`/`э`/`ё` cannot
    // appear in Bulgarian at all, so one of them settles the question outright,
    // while the stopword lists overlap enough ("за", "проект") to tie.
    const code = RUSSIAN_ONLY.test(text)
      ? "ru"
      : (scoreLanguages(tokens, ["bg", "ru"]) ?? "bg");
    return { code, name: LANGUAGE_NAMES[code] ?? null, script, source: "message" };
  }

  if (script === "latin") {
    const code = scoreLanguages(tokens, LATIN_CANDIDATES);
    return {
      code,
      name: code ? (LANGUAGE_NAMES[code] ?? null) : null,
      script,
      source: "message",
    };
  }

  return { code: null, name: null, script, source: "message" };
}

/**
 * The one system message that decides the reply language.
 *
 * Append it *after* the conversation history and before the user's message.
 * Position is the point: an instruction in the system prompt competes with
 * several thousand tokens of workspace data and, on a long thread, with a run
 * of earlier turns in another language. This one is the last thing the model
 * reads before the message it has to answer.
 *
 * Kept to a few sentences and free of shouting. It names one language, rules
 * out the specific failure mode (answering in a script the user did not use),
 * and says nothing else.
 */
export function replyLanguageDirective(language: ReplyLanguage): {
  role: "system";
  content: string;
} {
  const lines: string[] = ["## Reply language"];

  lines.push(
    language.name
      ? `Write this response in ${language.name}. Every string you output is in ${language.name} — prose, list items, questions, and any title, description or note body you draft.`
      : "Write this response in the same language as the user's message below. Every string you output is in that language — prose, list items, questions, and any title, description or note body you draft.",
  );

  if (language.script === "latin") {
    lines.push("The user wrote in the Latin alphabet. Do not answer in Cyrillic.");
  }

  if (language.source === "saved-locale") {
    lines.push(
      "The message has no words to read, so this is the user's saved interface language.",
    );
  }

  lines.push(
    "Examples and terminology elsewhere in these instructions are reference material. Whatever language they happen to be written in says nothing about the language of your answer.",
  );

  return { role: "system", content: lines.join("\n") };
}

/**
 * The trailing system messages every agent appends before the user's message.
 *
 * Two messages, in this order:
 *
 * 1. The language anchor, on the handoff path only — the user's own words
 *    behind another agent's paraphrase (see `languageAnchorMessages`).
 * 2. The directive, always — the language decision this server made.
 *
 * Every agent calls this in the same position, so a handoff cannot change the
 * reply language and there is one place to fix it when a model gets it wrong.
 *
 * @param message - what is being sent as the user turn. On the direct path this
 *   is the user's message; on the handoff path it is A1's paraphrase, which is
 *   deliberately *not* fed to the detector.
 * @param originalMessage - the user's own words, when `message` is a paraphrase.
 */
export function replyLanguageMessages(options: {
  locale?: SupportedLocale;
  message: string;
  originalMessage?: string;
}): Array<{ role: "system"; content: string }> {
  const { locale = DEFAULT_AGENT_LOCALE, message, originalMessage } = options;

  const anchor = languageAnchorMessages(originalMessage, message);
  // On the handoff path the paraphrase is A1's English-leaning restatement of
  // the request, so detecting on it would answer the wrong question. Use the
  // user's words when we have them and the message only when we do not.
  const detectOn = originalMessage?.trim() ? originalMessage : message;

  return [...anchor, replyLanguageDirective(detectReplyLanguage(locale, detectOn))];
}
