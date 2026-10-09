/**
 * Per-agent settings: what can be tuned about each agent, who may tune it, and
 * what it is until someone does.
 *
 * One catalog rather than a column per setting. Every entry carries its own
 * validator and default, so storage is two jsonb blobs (one on the workspace,
 * one on the user) and adding a setting is an entry here plus the code that
 * reads it — no migration.
 *
 * A plain module, like `agentNames`: the settings panel renders its controls
 * from this catalog and the server validates writes against the same entries.
 *
 * ## Scopes
 *
 * - **workspace** — shared by every member, written by an admin. Stored on
 *   `organizations.agent_settings`; for someone without a workspace, on their
 *   own `user.agent_settings`, the same fallback names use.
 * - **personal** — a preference about how an agent treats *you*: its tone, the
 *   time your brief arrives. Always `user.agent_settings`.
 *
 * Both blobs are flat maps keyed by setting id (`"risk_radar.stalledAfterDays"`),
 * holding only what someone changed. A missing or invalid value reads as the
 * default, so a renamed option or a hand-edited row degrades rather than breaks.
 *
 * ## `live`
 *
 * An entry with `live: false` is declared — shape, default, labels — but
 * nothing reads it yet, so the server refuses to save it and the panel shows it
 * as coming. Turning a setting on is flipping `live` in the same change that
 * makes the agent honour it.
 */

import { z } from "zod";

import type { AgentId } from "./agentNames";

export type AgentSettingScope = "workspace" | "personal";

export type AgentSettingControl =
  /** One of a few values, as a select. */
  | { kind: "choice"; options: readonly (string | number)[] }
  /** A subset of a few values, as a row of checks; `min` keeps the last one from being unticked. */
  | { kind: "multi"; options: readonly string[]; min?: number }
  | { kind: "toggle" }
  /** A short line of text, saved on Enter or blur. Empty means "none". */
  | { kind: "text"; maxLength: number; placeholder?: string }
  /** All of the workspace's projects, or a chosen few (`ProjectScope`). */
  | { kind: "projects" };

export interface AgentSettingDef<T = unknown> {
  agent: AgentId;
  key: string;
  scope: AgentSettingScope;
  live: boolean;
  control: AgentSettingControl;
  schema: z.ZodType<T>;
  default: T;
}

/**
 * Typed by the validator rather than the default, so an enum setting's value is
 * its union ("direct" | "friendly" | …) and not a widened `string`.
 */
const define = <S extends z.ZodTypeAny>(
  def: Omit<AgentSettingDef<z.output<S>>, "schema" | "default"> & {
    schema: S;
    default: z.output<S>;
  },
) => def;

const LANGUAGES = ["auto", "en", "bg", "de", "es", "fr"] as const;
const TONES = ["balanced", "direct", "friendly", "detailed"] as const;
const BRIEF_SECTIONS = ["dueToday", "events", "risks"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const NOTE_TEMPLATES = ["blank", "meeting", "decision"] as const;

/**
 * The parts a project naming pattern may use. Each stands for something the
 * agent fills in from the request or the calendar; see `projectNameFitsPattern`.
 */
export const NAMING_PLACEHOLDERS = ["client", "topic", "year", "quarter", "month"] as const;

export const NAMING_PATTERN_MAX = 60;

/**
 * Which projects an agent may touch: every one the user can, or only some.
 *
 * "only" needs at least one project — an empty list would mean "none", which
 * is what turning the agent off is for, not a scope.
 */
const PROJECT_SCOPE = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("only"),
    projectIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(200)
      .transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
  }),
]);

export type ProjectScope = z.output<typeof PROJECT_SCOPE>;

/** Whether a project is inside an agent's scope. */
export function inProjectScope(scope: ProjectScope, projectId: number): boolean {
  return scope.mode === "all" || scope.projectIds.includes(projectId);
}

/**
 * A naming pattern: literal text plus known `{placeholders}`.
 *
 * The pattern is written into the project manager's prompt, so the character
 * set is narrow on purpose — no newlines, quotes or backticks to carry an
 * instruction — and an unknown `{word}` is refused rather than passed through.
 */
const NAMING_PATTERN = z
  .string()
  .max(NAMING_PATTERN_MAX)
  // Before normalizing, which would fold a line break into a space.
  .refine((s) => !/[\r\n\u2028\u2029]/.test(s), "characters")
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .refine((s) => /^[\p{L}\p{N} ·\-_/.,:#&()'{}]*$/u.test(s), "characters")
  .refine(
    (s) =>
      [...s.matchAll(/\{([^{}]*)\}/g)].every((m) =>
        (NAMING_PLACEHOLDERS as readonly string[]).includes(m[1] ?? ""),
      ) && !/\{[^{}]*(\{|$)|^[^{]*\}|\}[^{]*\}/.test(s),
    "placeholder",
  );

export const AGENT_SETTINGS = {
  "workspace_concierge.tone": define({
    agent: "workspace_concierge",
    key: "tone",
    scope: "personal",
    live: true,
    control: { kind: "choice", options: TONES },
    schema: z.enum(TONES),
    default: "balanced",
  }),
  "workspace_concierge.replyLanguage": define({
    agent: "workspace_concierge",
    key: "replyLanguage",
    scope: "personal",
    live: true,
    control: { kind: "choice", options: LANGUAGES },
    schema: z.enum(LANGUAGES),
    default: "auto",
  }),
  "daily_brief.sections": define({
    agent: "daily_brief",
    key: "sections",
    scope: "personal",
    live: true,
    // At least one: a brief with every section off is the schedule's off switch
    // wearing a different label, and that switch already exists.
    control: { kind: "multi", options: BRIEF_SECTIONS, min: 1 },
    // Order-free and duplicate-free, so two saves of the same choice compare equal.
    schema: z
      .array(z.enum(BRIEF_SECTIONS))
      .min(1)
      .max(BRIEF_SECTIONS.length)
      .transform((picked) => BRIEF_SECTIONS.filter((s) => picked.includes(s))),
    default: [...BRIEF_SECTIONS],
  }),
  "risk_radar.stalledAfterDays": define({
    agent: "risk_radar",
    key: "stalledAfterDays",
    scope: "personal",
    live: true,
    control: { kind: "choice", options: [7, 14, 30] },
    schema: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    default: 14,
  }),
  "meeting_prep.leadMinutes": define({
    agent: "meeting_prep",
    key: "leadMinutes",
    scope: "personal",
    live: true,
    // The scheduler ticks every 5 minutes, so even 15 leaves three chances to
    // catch a meeting before it starts.
    control: { kind: "choice", options: [15, 30, 60, 90] },
    schema: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]),
    default: 90,
  }),

  // ---- Specialists: workspace defaults, set by an admin -------------------

  "task_planner.priority": define({
    agent: "task_planner",
    key: "priority",
    scope: "workspace",
    live: true,
    control: { kind: "choice", options: PRIORITIES },
    schema: z.enum(PRIORITIES),
    // What the task form and the column default to, so "unchanged" means unchanged.
    default: "medium",
  }),
  "task_planner.dueInDays": define({
    agent: "task_planner",
    key: "dueInDays",
    scope: "workspace",
    live: true,
    control: { kind: "choice", options: ["none", 1, 3, 7, 14, 30] },
    schema: z.union([
      z.literal("none"),
      z.literal(1),
      z.literal(3),
      z.literal(7),
      z.literal(14),
      z.literal(30),
    ]),
    default: "none",
  }),
  "task_planner.assignee": define({
    agent: "task_planner",
    key: "assignee",
    scope: "workspace",
    live: true,
    control: { kind: "choice", options: ["none", "requester"] },
    schema: z.enum(["none", "requester"]),
    default: "none",
  }),
  // Scope is enforced twice: the agent only sees projects inside it, and the
  // apply step refuses anything outside it — see `inProjectScope`.
  "task_planner.scope": define({
    agent: "task_planner",
    key: "scope",
    scope: "workspace",
    live: true,
    control: { kind: "projects" },
    schema: PROJECT_SCOPE,
    default: { mode: "all" },
  }),
  "task_planner.approval": define({
    agent: "task_planner",
    key: "approval",
    // Personal: whether *you* want small changes to skip the confirm step.
    scope: "personal",
    live: true,
    control: { kind: "choice", options: ["ask", "autoSmall"] },
    schema: z.enum(["ask", "autoSmall"]),
    default: "ask",
  }),
  "task_planner.allowAutoApply": define({
    agent: "task_planner",
    key: "allowAutoApply",
    // The workspace's ceiling over the personal choice above. On by default so
    // nobody has to ask an admin first; an admin can switch it off for everyone.
    scope: "workspace",
    live: true,
    control: { kind: "toggle" },
    schema: z.boolean(),
    default: true,
  }),
  "notes_vault.approval": define({
    agent: "notes_vault",
    key: "approval",
    // Personal: whether *you* want small changes to skip the confirm step.
    scope: "personal",
    live: true,
    control: { kind: "choice", options: ["ask", "autoSmall"] },
    schema: z.enum(["ask", "autoSmall"]),
    default: "ask",
  }),
  "notes_vault.allowAutoApply": define({
    agent: "notes_vault",
    key: "allowAutoApply",
    // The workspace's ceiling over the personal choice above. On by default so
    // nobody has to ask an admin first; an admin can switch it off for everyone.
    scope: "workspace",
    live: true,
    control: { kind: "toggle" },
    schema: z.boolean(),
    default: true,
  }),
  "notes_vault.template": define({
    agent: "notes_vault",
    key: "template",
    scope: "workspace",
    live: true,
    control: { kind: "choice", options: NOTE_TEMPLATES },
    schema: z.enum(NOTE_TEMPLATES),
    default: "blank",
  }),
  "events_publisher.lengthMinutes": define({
    agent: "events_publisher",
    key: "lengthMinutes",
    scope: "workspace",
    live: true,
    control: { kind: "choice", options: ["none", 30, 60, 90, 120, 240] },
    schema: z.union([
      z.literal("none"),
      z.literal(30),
      z.literal(60),
      z.literal(90),
      z.literal(120),
      z.literal(240),
    ]),
    default: "none",
  }),
  "events_publisher.enableRsvp": define({
    agent: "events_publisher",
    key: "enableRsvp",
    scope: "workspace",
    live: true,
    control: { kind: "toggle" },
    schema: z.boolean(),
    // On, as Iris's prompt defaulted it before this setting existed.
    default: true,
  }),
  "events_publisher.sendReminders": define({
    agent: "events_publisher",
    key: "sendReminders",
    scope: "workspace",
    live: true,
    control: { kind: "toggle" },
    schema: z.boolean(),
    default: false,
  }),
  "project_manager.scope": define({
    agent: "project_manager",
    key: "scope",
    scope: "workspace",
    live: true,
    control: { kind: "projects" },
    schema: PROJECT_SCOPE,
    default: { mode: "all" },
  }),
  "project_manager.namingPattern": define({
    agent: "project_manager",
    key: "namingPattern",
    scope: "workspace",
    live: true,
    control: { kind: "text", maxLength: NAMING_PATTERN_MAX, placeholder: "{client} · {quarter} {year}" },
    schema: NAMING_PATTERN,
    default: "",
  }),
} as const;

export type AgentSettingId = keyof typeof AGENT_SETTINGS;

export type AgentSettingValue<I extends AgentSettingId> = z.output<(typeof AGENT_SETTINGS)[I]["schema"]>;

/** Every setting with the value in force for one user. */
export type ResolvedAgentSettings = { [I in AgentSettingId]: AgentSettingValue<I> };

export const AGENT_SETTING_IDS = Object.keys(AGENT_SETTINGS) as AgentSettingId[];

export function isAgentSettingId(value: unknown): value is AgentSettingId {
  return typeof value === "string" && Object.hasOwn(AGENT_SETTINGS, value);
}

/** The settings belonging to one agent, in catalog order. */
export function settingsForAgent(agent: AgentId): AgentSettingId[] {
  return AGENT_SETTING_IDS.filter((id) => AGENT_SETTINGS[id].agent === agent);
}

/** The defaults, for anyone who has changed nothing — and for tests. */
export function defaultAgentSettings(): ResolvedAgentSettings {
  const out = {} as Record<AgentSettingId, unknown>;
  for (const id of AGENT_SETTING_IDS) out[id] = AGENT_SETTINGS[id].default;
  return out as ResolvedAgentSettings;
}

/** A stored value, or the default when it is missing or no longer valid. */
function parseStored(id: AgentSettingId, stored: unknown): unknown {
  const def = AGENT_SETTINGS[id] as AgentSettingDef;
  if (!stored || typeof stored !== "object" || !Object.hasOwn(stored, id)) return def.default;
  const parsed = def.schema.safeParse((stored as Record<string, unknown>)[id]);
  return parsed.success ? parsed.data : def.default;
}

/**
 * The values in force, from the two stored blobs.
 *
 * `workspace` is the blob workspace-scoped settings come from — the
 * organization's, or the user's own when they have no workspace; `personal` is
 * always the user's.
 */
export function resolveAgentSettings(stored: {
  workspace: unknown;
  personal: unknown;
}): ResolvedAgentSettings {
  const out = {} as Record<AgentSettingId, unknown>;
  for (const id of AGENT_SETTING_IDS) {
    const source = AGENT_SETTINGS[id].scope === "workspace" ? stored.workspace : stored.personal;
    out[id] = parseStored(id, source);
  }
  return out as ResolvedAgentSettings;
}

/**
 * One value from a pack that may not carry settings at all — a prompt built in
 * a test, or by a caller that predates them.
 */
export function agentSetting<I extends AgentSettingId>(
  resolved: Partial<ResolvedAgentSettings> | undefined,
  id: I,
): AgentSettingValue<I> {
  return (resolved?.[id] ?? AGENT_SETTINGS[id].default) as AgentSettingValue<I>;
}

/**
 * Whether a project name follows a naming pattern.
 *
 * Literal parts must match (ignoring case); `{year}` is four digits,
 * `{quarter}` Q1–Q4, `{month}` a word or a number, and `{client}`/`{topic}`
 * any non-empty text. An empty pattern accepts every name.
 */
export function projectNameFitsPattern(name: string, pattern: string): boolean {
  if (!pattern.trim()) return true;
  const PART: Record<(typeof NAMING_PLACEHOLDERS)[number], string> = {
    client: ".+?",
    topic: ".+?",
    year: "\\d{4}",
    quarter: "Q[1-4]",
    month: "(?:\\p{L}+|\\d{1,2})",
  };
  let source = "";
  let cursor = 0;
  for (const m of pattern.matchAll(/\{([a-z]+)\}/g)) {
    source += escapeRegExp(pattern.slice(cursor, m.index));
    source += PART[m[1] as keyof typeof PART] ?? escapeRegExp(m[0]);
    cursor = (m.index ?? 0) + m[0].length;
  }
  source += escapeRegExp(pattern.slice(cursor));
  return new RegExp(`^${source}$`, "iu").test(name.trim().replace(/\s+/g, " "));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** Validates a value for saving, returning it normalized. */
export function parseAgentSettingValue(
  id: AgentSettingId,
  value: unknown,
): { ok: true; value: unknown } | { ok: false } {
  const parsed = (AGENT_SETTINGS[id] as AgentSettingDef).schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
