import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({

  server: {
    // ---------------------------------------------------------------------
    // Required. These were all `.optional()`, which defeated the point of
    // validating: a deploy missing its auth secret or database URL booted
    // successfully and failed later in confusing ways — the DB layer silently
    // substituted a hardcoded localhost connection string. Fail fast instead.
    //
    // Set SKIP_ENV_VALIDATION=1 for lint/typecheck/CI steps that don't need a
    // real environment.
    // ---------------------------------------------------------------------

    // 32-char floor mirrors the check ws-server already enforced on its own
    // secret; a short secret weakens JWT and cookie signing.
    AUTH_SECRET: z.string().min(32),
    DATABASE_URL: z.string().url(),
    WS_SECRET: z.string().min(32),

    // ---------------------------------------------------------------------
    // Optional: these features degrade cleanly when unset.
    // ---------------------------------------------------------------------
    AUTH_DISCORD_ID: z.string().optional(),
    AUTH_DISCORD_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_MICROSOFT_ID: z.string().optional(),
    AUTH_MICROSOFT_SECRET: z.string().optional(),

    // LLM Agent System (any OpenAI-compatible /chat/completions endpoint).
    //
    // Optional so the app still boots with the AI disabled, but every agent
    // call fails without a key — the model client logs a warning at startup
    // rather than letting that surface as a vague chat error.
    /**
     * Named provider preset from `src/server/llm/core/providers.ts`, supplying
     * the base URL, model chain and which key variable to read. Lets one `.env`
     * hold every machine's provider at once and switch with a single line.
     * Unset = configure LLM_BASE_URL / LLM_MODEL directly.
     *
     * Not an enum here on purpose: the preset table is the single source of
     * truth for the valid names, and duplicating it would let the two drift.
     */
    LLM_PROVIDER: z.string().optional(),
    /** Overrides the preset's base URL when set. */
    LLM_BASE_URL: z.string().url().optional(),
    /** Shared key, used when the selected provider has no key of its own. */
    LLM_API_KEY: z.string().optional(),
    // Per-provider keys, read as LLM_API_KEY_<PROVIDER> in preference to the
    // shared one. Declared so both machines' keys can sit in one .env without
    // either being the "current" value that a switch has to overwrite.
    LLM_API_KEY_NVIDIA: z.string().optional(),
    LLM_API_KEY_VELOCITY: z.string().optional(),
    LLM_API_KEY_DEEPSEEK: z.string().optional(),
    /** Overrides the preset's primary model — and, with it, its fallback. */
    LLM_MODEL: z.string().optional(),
    /** Only tried when the primary model fails retriably. Empty = no fallback. */
    LLM_FALLBACK_MODEL: z.string().optional(),
    /**
     * Cheap model for short, mechanical work — conversation titles, rolling
     * summaries, JSON repair. Unset falls back to LLM_MODEL, so tiering is an
     * optimisation rather than a requirement.
     */
    LLM_MODEL_FAST: z.string().optional(),
    /**
     * Chain-of-thought budget for the strong tier, on models that expose one —
     * either as a `reasoning_effort` chat-template flag or as a top-level
     * `reasoning_effort` field. Reasoning is emitted before the first visible
     * character, so this is the main dial on how long a turn looks like it is
     * doing nothing. Unset = "medium".
     *
     * Not every model offers every rung: Kimi K3's ladder is low/high/max, and a
     * value it does not support resolves downwards to one it does. "max" is here
     * because K3 accepts it, and it is almost never what you want — it is that
     * model's *default*, which is precisely the latency this dial exists to cut.
     */
    LLM_REASONING_EFFORT: z.enum(["low", "medium", "high", "max"]).optional(),
    /** AI requests per user per rolling 24h window. */
    AI_RATE_LIMIT: z.coerce.number().int().positive().default(50),
    /**
     * Scheduled (proactive) AI runs per user per rolling 24h window. Kept
     * separate from AI_RATE_LIMIT so a daily brief can never consume budget the
     * user was going to spend on their own questions.
     */
    AI_SYSTEM_RATE_LIMIT: z.coerce.number().int().positive().default(20),

    // Email (Resend)
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),

    WS_INTERNAL_URL: z.string().optional(),

    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  client: {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
    NEXT_PUBLIC_WS_URL: z.string().optional(),
    // Declared here rather than under `server`: the NEXT_PUBLIC_ prefix means
    // Next inlines it into the client bundle, so validating it as a server-only
    // variable was checking it in the wrong scope. Client vars stay readable on
    // the server, so existing server-side reads are unaffected.
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  },


  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    AUTH_MICROSOFT_ID: process.env.AUTH_MICROSOFT_ID,
    AUTH_MICROSOFT_SECRET: process.env.AUTH_MICROSOFT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,

    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_API_KEY_NVIDIA: process.env.LLM_API_KEY_NVIDIA,
    LLM_API_KEY_VELOCITY: process.env.LLM_API_KEY_VELOCITY,
    LLM_API_KEY_DEEPSEEK: process.env.LLM_API_KEY_DEEPSEEK,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_FALLBACK_MODEL: process.env.LLM_FALLBACK_MODEL,
    LLM_MODEL_FAST: process.env.LLM_MODEL_FAST,
    LLM_REASONING_EFFORT: process.env.LLM_REASONING_EFFORT,
    AI_RATE_LIMIT: process.env.AI_RATE_LIMIT,
    AI_SYSTEM_RATE_LIMIT: process.env.AI_SYSTEM_RATE_LIMIT,

    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,

    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    WS_SECRET: process.env.WS_SECRET,
    WS_INTERNAL_URL: process.env.WS_INTERNAL_URL,
  },

  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
