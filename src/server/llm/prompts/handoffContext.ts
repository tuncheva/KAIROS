/**
 * What A1 already collected before handing off, as a message the sub-agent reads.
 *
 * A1 hands off with a `context` object — the project name the user gave, the
 * project id it resolved — and every sub-agent accepted it, but only A2 ever
 * showed it to its model. The rest drafted from `userIntent` alone. So a user
 * who answered "училище" to "what should the project be called?" saw A1 hand
 * off `{ projectName: "училище" }`, and Daedalus ask for the name again.
 *
 * A system message rather than text folded into the user turn: the user turn is
 * what reply-language detection reads, and English JSON keys there would tip it.
 */

/**
 * Keys never shown to a model. `unlockedNotes` carries the plaintext of locked
 * notes for A3's apply-time guard; A3 reads it through its own context builder,
 * and it has no business in a prompt.
 */
const PRIVATE_KEYS = new Set(["unlockedNotes"]);

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Zero or one system message stating the handoff context. */
export function handoffContextMessages(
  context: Record<string, unknown> | undefined,
): Array<{ role: "system"; content: string }> {
  if (!context) return [];
  const shown = Object.fromEntries(
    Object.entries(context).filter(([key, value]) => !PRIVATE_KEYS.has(key) && !isEmpty(value)),
  );
  if (Object.keys(shown).length === 0) return [];
  return [
    {
      role: "system",
      content: `The concierge already collected these details from the user earlier in the conversation. Treat them as given: use them, and do not ask for them again.
${JSON.stringify(shown, null, 2)}`,
    },
  ];
}
