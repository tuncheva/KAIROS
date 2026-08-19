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

    // LLM Agent System (OpenAI-compatible — can point to HuggingFace, OpenAI, etc.)
    LLM_BASE_URL: z.string().url().optional(),
    LLM_API_KEY: z.string().optional(),
    LLM_DEFAULT_MODEL: z.string().optional(),
    LLM_FALLBACK_MODEL: z.string().optional(),
    LLM_ALTERNATE_MODEL: z.string().optional(),

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

    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_DEFAULT_MODEL: process.env.LLM_DEFAULT_MODEL,
    LLM_FALLBACK_MODEL: process.env.LLM_FALLBACK_MODEL,
    LLM_ALTERNATE_MODEL: process.env.LLM_ALTERNATE_MODEL,

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
