/**
 * What a workspace may call its agents.
 *
 * Every agent ships with a persona from Greek myth (see the registry), and a
 * workspace admin can replace any of them. The replacement is shared by the
 * whole workspace and is what the agent calls itself in chat, so it ends up in
 * three places: the UI, the system prompts, and the handoff messages.
 *
 * A plain module with no server imports, because the settings form validates a
 * name as it is typed with the same rule the server enforces on save.
 *
 * Only overrides are stored. A missing key means "the default", so a renamed
 * default (or a new agent added later) never needs a data migration.
 */

export const AGENT_IDS = [
  "workspace_concierge",
  "task_planner",
  "notes_vault",
  "events_publisher",
  "org_admin",
  "project_manager",
  "daily_brief",
  "risk_radar",
  "weekly_retro",
  "meeting_prep",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

/** The untranslated persona names. The UI prefers `agents.names.<id>`, which spells them per locale. */
export const DEFAULT_AGENT_NAMES: Readonly<Record<AgentId, string>> = {
  workspace_concierge: "Mentor",
  task_planner: "Odysseus",
  notes_vault: "Mnemosyne",
  events_publisher: "Iris",
  org_admin: "Solon",
  project_manager: "Daedalus",
  daily_brief: "Hemera",
  risk_radar: "Argus",
  weekly_retro: "Clio",
  meeting_prep: "Nestor",
};

export type AgentNameOverrides = Partial<Record<AgentId, string>>;

export const AGENT_NAME_MAX = 24;

/**
 * Letters and digits in any script, with single spaces, apostrophes, dots and
 * hyphens between them.
 *
 * Narrow on purpose: the name is written into system prompts, so a newline, a
 * backtick or a bracket is a way to smuggle an instruction in rather than a
 * name anybody needs.
 */
const NAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}'’.-]|\s(?!\s))*$/u;

/** Line breaks are refused rather than folded into spaces: a pasted paragraph is not a name. */
const LINE_BREAK = /[\r\n\u2028\u2029]/;

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);
}

/** Trims and collapses inner whitespace, the form a name is stored and compared in. */
export function normalizeAgentName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export type AgentNameProblem = "empty" | "tooLong" | "characters" | "taken";

/**
 * Why `raw` cannot be the name of `id`, or null when it can.
 *
 * "taken" compares against what every other agent is called right now,
 * defaults included, ignoring case: two agents answering to the same name
 * would leave the concierge unable to say who it is handing work to.
 */
export function agentNameProblem(
  id: AgentId,
  raw: string,
  overrides: AgentNameOverrides,
): AgentNameProblem | null {
  if (LINE_BREAK.test(raw)) return "characters";
  const name = normalizeAgentName(raw);
  if (!name) return "empty";
  if (name.length > AGENT_NAME_MAX) return "tooLong";
  if (!NAME_PATTERN.test(name)) return "characters";
  const lower = name.toLocaleLowerCase();
  const clash = AGENT_IDS.some(
    (other) => other !== id && agentNameFor(other, overrides).toLocaleLowerCase() === lower,
  );
  return clash ? "taken" : null;
}

/** The name an agent goes by in this workspace. */
export function agentNameFor(id: AgentId, overrides?: AgentNameOverrides | null): string {
  return overrides?.[id] ?? DEFAULT_AGENT_NAMES[id];
}

/**
 * Keeps only entries that are still valid, for reading the stored JSON.
 *
 * The column is written through `agentNameProblem`, but a row edited by hand or
 * written before an agent was removed should degrade to the default rather than
 * put an unchecked string into a prompt.
 */
export function sanitizeAgentNameOverrides(value: unknown): AgentNameOverrides {
  if (!value || typeof value !== "object") return {};
  const out: AgentNameOverrides = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isAgentId(key) || typeof raw !== "string" || LINE_BREAK.test(raw)) continue;
    const name = normalizeAgentName(raw);
    if (name && name.length <= AGENT_NAME_MAX && NAME_PATTERN.test(name)) out[key] = name;
  }
  return out;
}
