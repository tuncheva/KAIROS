/**
 * The scope vocabulary for `ai_user_memory`, with no server binding.
 *
 * These constants started life in `server/llm/memory.ts`, which is `server-only`
 * — so the settings page could not import them and hardcoded `"global"` as a
 * string literal instead. That is the kind of duplication that survives a rename:
 * the loader would start reading a new scope while the UI kept filtering on the
 * old one, and nothing would fail loudly.
 *
 * Split out for the same reason `lib/entitlements` and `lib/timezone` are:
 * the values are shared vocabulary, and only the behaviour needs the server.
 * `server/llm/memory.ts` re-exports everything here, so existing imports are
 * unaffected.
 */

/** Facts that apply to every agent. */
export const GLOBAL_SCOPE = "global";

/**
 * Standing rules the user set, which the model may read but never write.
 *
 * The write guard lives in `rememberFactTool`; this is only the name. See that
 * tool for why the asymmetry exists.
 */
export const INSTRUCTION_SCOPE = "instruction";

/**
 * How many global facts may exist per user.
 *
 * Chosen so the block stays a rounding error against a system prompt: twenty
 * facts at 200 characters is under 1.5 KB, which is smaller than the tool
 * definitions already in every request.
 */
export const MAX_FACTS = 20;

/**
 * How many facts may exist per agent, on top of the global set.
 *
 * Deliberately smaller. The property worth preserving is not "20 rows" but "the
 * memory block never dominates the prompt", and only two scopes are ever loaded
 * at once — global plus the agent running. Ten keeps the worst case bounded no
 * matter how many agents accumulate memories, where a flat 20 per scope across
 * seven agents would have read as 140 rows to a reader of the settings page
 * while still only ever injecting 40.
 */
export const MAX_AGENT_FACTS = 10;

/**
 * How many standing rules may exist per user.
 *
 * Matched to {@link MAX_AGENT_FACTS} for the same reason — the ceiling that
 * matters is the size of the prompt block, and rules are always loaded, for
 * every agent, on every turn. Unlike agent-scoped facts they are never mutually
 * exclusive, so ten here is ten in every request.
 */
export const MAX_INSTRUCTIONS = 10;

/** Longest a single stored value may be, in characters. */
export const MAX_VALUE_CHARS = 200;
