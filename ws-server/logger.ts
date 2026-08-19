/**
 * Logging for the WebSocket process.
 *
 * A separate copy of the app's logger rather than an import from `src/server`:
 * this process is built and run on its own (`node --import tsx ws-server/index.ts`)
 * and deliberately shares no module graph with the Next.js app, so reaching across
 * would drag `~/env` and its validation in with it.
 *
 * The behaviour that matters is the same as `src/server/logger.ts`: levels via
 * `LOG_LEVEL`, redaction of anything that looks sensitive, and truncated user ids.
 * Every room join and leave used to be logged at info level with the full user id
 * and room name — on a busy socket that is a continuous stream of identifiers into
 * whatever collects stdout. Those are now `debug`, and denials stay at `warn`
 * because a denial is worth seeing in production.
 */

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configured(): Level | "silent" {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "silent") return "silent";
  if (raw && raw in ORDER) return raw as Level;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function enabled(level: Level): boolean {
  const c = configured();
  return c !== "silent" && ORDER[level] >= ORDER[c];
}

const SENSITIVE = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "pin",
  "hash",
  "salt",
  "apikey",
  "credential",
  "content",
];

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0) return "[redacted]";
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

function maskText(text: string): string {
  return text.replace(EMAIL, (m) => maskEmail(m));
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, message: maskText(value.message) };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (SENSITIVE.some((p) => lower.includes(p))) out[k] = "[redacted]";
      else if (lower.includes("userid") && typeof v === "string")
        out[k] = v.length > 12 ? `${v.slice(0, 8)}…` : v;
      else if (lower.includes("email") && typeof v === "string") out[k] = maskEmail(v);
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  // A symbol or an exotic object: describe it rather than risk "[object Object]".
  if (typeof value === "symbol") return value.toString();
  try {
    return JSON.stringify(value) ?? "[unserialisable]";
  } catch {
    return "[unserialisable]";
  }
}

export type LogContext = Record<string, unknown>;

function emit(level: Level, scope: string, message: string, context?: LogContext): void {
  if (!enabled(level)) return;

  const safeMessage = maskText(message);
  const safeContext = context ? (redact(context) as LogContext) : undefined;
  const method = level === "debug" ? "log" : level;

  if (process.env.NODE_ENV === "production") {
    console[method](
      JSON.stringify({
        level,
        scope,
        message: safeMessage,
        ...(safeContext ? { context: safeContext } : {}),
        time: new Date().toISOString(),
      }),
    );
    return;
  }

  console[method](
    `[${scope}]`,
    safeMessage,
    ...(safeContext && Object.keys(safeContext).length ? [safeContext] : []),
  );
}

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, c) => emit("debug", scope, m, c),
    info: (m, c) => emit("info", scope, m, c),
    warn: (m, c) => emit("warn", scope, m, c),
    error: (m, c) => emit("error", scope, m, c),
  };
}
