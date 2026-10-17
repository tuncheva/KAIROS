/**
 * Provider presets — one env var to switch which endpoint serves the agents.
 *
 * The endpoint was always env-driven, but every switch meant rewriting four
 * variables by hand and remembering which model ids that particular gateway
 * namespaces how. That is a per-machine detail: this checkout runs against a
 * DeepSeek gateway, another runs on NVIDIA's free NIM tier, and neither wants
 * the other's values in its `.env`.
 *
 * So both live there at once. `LLM_PROVIDER` picks one; each preset carries the
 * base URL, the model chain and the *name* of the key variable it reads, so the
 * keys sit side by side under distinct names and only the selected one is used.
 *
 * Precedence, highest first:
 *
 * 1. Explicit `LLM_BASE_URL` / `LLM_MODEL` / `LLM_FALLBACK_MODEL` /
 *    `LLM_MODEL_FAST` — a set value always wins, so a one-off experiment needs
 *    no preset and an unlisted provider needs no code change.
 * 2. The `LLM_PROVIDER` preset.
 * 3. Nothing. With `LLM_PROVIDER` unset this module is a pass-through and the
 *    raw variables behave exactly as they did before it existed.
 *
 * Keys follow the same shape: `LLM_API_KEY_<PROVIDER>` if set, else the shared
 * `LLM_API_KEY`.
 *
 * **Backup provider.** `LLM_BACKUP_PROVIDER` names a second preset that the
 * model client tries once every primary model has failed. It exists because a
 * fallback *model* on the same gateway shares that gateway's outages: on
 * 2026-10-11 NIM listed eight candidate models and only one of them served.
 * A second provider is a separate failure domain. `LLM_BACKUP_BASE_URL` /
 * `LLM_BACKUP_API_KEY` / `LLM_BACKUP_MODEL` / `LLM_BACKUP_MODEL_FAST` override
 * it the same way the primary variables do. The backup never borrows the shared
 * `LLM_API_KEY`: that key belongs to the primary, and sending it to a second
 * host would leak it for a guaranteed 401.
 *
 * Pure and dependency-free on purpose — `~/env` is server-only, and
 * `scripts/llm-probe.ts` has to resolve identically from raw `process.env` or it
 * verifies a configuration the app never sends.
 */

export const LLM_PROVIDERS = ["nvidia", "velocity", "deepseek", "gemini"] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

interface ProviderPreset {
  /** No trailing slash; `/chat/completions` is appended by the caller. */
  baseUrl: string;
  model: string;
  /** Tried only when `model` fails retriably. Omit for no fallback. */
  fallbackModel?: string;
  /** Cheap tier for titles, summaries and JSON repair. */
  fastModel?: string;
  /** Env var holding this provider's key, checked before `LLM_API_KEY`. */
  keyVar: string;
}

/**
 * Model ids are namespaced per gateway — the same weights are
 * `deepseek-ai/deepseek-v4-flash` on NIM and `deepseek/deepseek-v4-flash` on
 * Velocity — which is most of what made switching by hand error-prone.
 *
 * NVIDIA's free tier is development-only: its terms forbid personal data and
 * permit training on content. See docs/llm-provider-research-2026-08-21.md.
 *
 * The NIM preset is pinned to the one model that both served and wrote usable
 * Bulgarian when re-probed on 2026-10-11. The DeepSeek V4 ids it used to name
 * return 410 (end of life 2026-08-07). `kimi-k3`, `glm-5.3`,
 * `deepseek-v4.1-flash` and `gemma-4-31b-it` are listed in `/models` but sent no
 * first byte, and `nemotron-3-super` code-switches out of Bulgarian. So it has no
 * same-gateway fallback on purpose: the backup provider is the fallback.
 *
 * Gemini's ids come from docs/llm-free-provider-research-2026-10-09.md and are
 * unverified until `pnpm llm:probe -- --backup` passes with a real key. Its
 * free quota is per model, which is why a second Gemini model is a worthwhile
 * fallback there while a second NIM model is not.
 */
const PRESETS: Record<LlmProvider, ProviderPreset> = {
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "openai/gpt-oss-20b",
    fastModel: "openai/gpt-oss-20b",
    keyVar: "LLM_API_KEY_NVIDIA",
  },
  velocity: {
    baseUrl: "https://chat.velocity.online/api/v1",
    model: "deepseek/deepseek-v4-flash",
    fastModel: "deepseek/deepseek-v4-flash",
    keyVar: "LLM_API_KEY_VELOCITY",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyVar: "LLM_API_KEY_DEEPSEEK",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    fallbackModel: "gemini-3.1-flash-lite",
    fastModel: "gemini-3.1-flash-lite",
    keyVar: "LLM_API_KEY_GEMINI",
  },
};

/** The variables this module reads. Satisfied by both `~/env` and `process.env`. */
export interface LlmEnvSource {
  LLM_PROVIDER?: string | undefined;
  LLM_BASE_URL?: string | undefined;
  LLM_API_KEY?: string | undefined;
  LLM_MODEL?: string | undefined;
  LLM_FALLBACK_MODEL?: string | undefined;
  LLM_MODEL_FAST?: string | undefined;
  /** Per-provider keys are read by name, so the shape stays open. */
  [key: string]: unknown;
}

/** One endpoint plus the models to try on it, in order. */
export interface ResolvedLlmLane {
  /** Which preset applied, or null when configured by raw variables alone. */
  provider: LlmProvider | null;
  /** Trailing slashes stripped. Empty string when unconfigured. */
  baseUrl: string;
  apiKey: string;
  /** Primary then fallback, empties dropped. */
  models: string[];
  /** Cheap tier, or null to reuse `models`. */
  fastModel: string | null;
}

export interface ResolvedLlmConfig extends ResolvedLlmLane {
  /** Second provider, tried after every primary model. Null when not fully configured. */
  backup: ResolvedLlmLane | null;
}

/** A trimmed non-empty string, or undefined — `LLM_FALLBACK_MODEL=` means "none". */
function value(source: LlmEnvSource, key: string): string | undefined {
  const raw = source[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The named preset, or null for unset. An unknown name throws rather than silently falling back. */
function selectPreset(
  source: LlmEnvSource,
  variable = "LLM_PROVIDER",
): ProviderPreset | null {
  const name = value(source, variable)?.toLowerCase();
  if (!name) return null;
  const preset = PRESETS[name as LlmProvider];
  if (!preset) {
    throw new Error(
      `${variable}="${name}" is not a known provider. Use one of ${LLM_PROVIDERS.join(", ")}, ` +
        "or unset it and set the base URL / model variables directly.",
    );
  }
  return preset;
}

/**
 * The backup lane, or null unless it has a base URL, a key and a model.
 *
 * Half-configured is treated as off rather than as an error: the backup is an
 * extra, and a missing key there must never stop the primary from serving.
 */
function resolveBackup(source: LlmEnvSource): ResolvedLlmLane | null {
  const preset = selectPreset(source, "LLM_BACKUP_PROVIDER");
  const baseUrl = value(source, "LLM_BACKUP_BASE_URL") ?? preset?.baseUrl;
  const apiKey =
    value(source, "LLM_BACKUP_API_KEY") ??
    (preset ? value(source, preset.keyVar) : undefined);
  const model = value(source, "LLM_BACKUP_MODEL") ?? preset?.model;
  if (!baseUrl || !apiKey || !model) return null;

  const fallback = value(source, "LLM_BACKUP_MODEL") ? undefined : preset?.fallbackModel;
  return {
    provider: preset
      ? (value(source, "LLM_BACKUP_PROVIDER")!.toLowerCase() as LlmProvider)
      : null,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    models: [model, fallback].filter((m): m is string => typeof m === "string"),
    fastModel: value(source, "LLM_BACKUP_MODEL_FAST") ?? preset?.fastModel ?? null,
  };
}

/** Resolve the effective endpoint, key and model chain. See the module comment for precedence. */
export function resolveLlmConfig(source: LlmEnvSource): ResolvedLlmConfig {
  const preset = selectPreset(source);
  const provider =
    (value(source, "LLM_PROVIDER")?.toLowerCase() as LlmProvider | undefined) ?? null;

  const baseUrl = value(source, "LLM_BASE_URL") ?? preset?.baseUrl ?? "";
  const apiKey =
    (preset ? value(source, preset.keyVar) : undefined) ??
    value(source, "LLM_API_KEY") ??
    "";

  const model = value(source, "LLM_MODEL") ?? preset?.model;
  // An explicit LLM_MODEL replaces the preset's chain entirely: pairing a
  // hand-picked primary with a preset fallback it was never tested against is a
  // worse default than no fallback at all.
  const fallback = value(source, "LLM_FALLBACK_MODEL")
    ?? (value(source, "LLM_MODEL") ? undefined : preset?.fallbackModel);

  return {
    provider: preset ? provider : null,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    models: [model, fallback].filter((m): m is string => typeof m === "string"),
    fastModel: value(source, "LLM_MODEL_FAST") ?? preset?.fastModel ?? null,
    backup: resolveBackup(source),
  };
}
