/**
 * Structured server logging with levels and redaction.
 *
 * ## Why
 *
 * There were ~60 bare `console.*` calls in `src/server` and another ~24 in
 * `ws-server`, logging user ids, organization ids, email addresses and raw error
 * objects straight to stdout — with no level control, so debug chatter shipped to
 * production, and no redaction, so anything that shipped logs anywhere else
 * shipped personal data with it. `ws-server` logged every room join and leave at
 * info level, which on a busy socket is a lot of identifiers.
 *
 * ## What this gives
 *
 * - **Levels.** `LOG_LEVEL` (`debug|info|warn|error|silent`) gates output;
 *   defaults to `info` in production and `debug` elsewhere. `logger.debug` calls
 *   can be left in place and cost nothing when disabled.
 * - **Redaction.** Values under keys that look sensitive are replaced. Emails are
 *   partially masked wherever they appear, including inside message strings, and
 *   long opaque identifiers are truncated. The goal is logs that stay useful for
 *   correlation without being a copy of the users table.
 * - **One line of JSON per event in production**, so a log shipper can parse it;
 *   human-readable text in development.
 *
 * Redaction is best-effort by design: it cannot know that a field named `note` is
 * a private note body. Do not pass user content, tokens, or password material and
 * expect this to save you — pass an id and look the record up.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw && (raw in LEVEL_ORDER || raw === "silent")) return raw as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function isEnabled(level: Exclude<LogLevel, "silent">): boolean {
  const configured = configuredLevel();
  if (configured === "silent") return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Field names whose values are replaced outright.
 *
 * Matched case-insensitively as a substring, so `passwordHash`, `reset_pin_hash`
 * and `authSecret` are all covered without listing every variant.
 */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "pin",
  "hash",
  "salt",
  "apikey",
  "api_key",
  "credential",
  "content", // note and message bodies
];

const REDACTED = "[redacted]";

/**
 * Exact key names that survive the pattern match above.
 *
 * `token` is in the sensitive list to catch auth material, which also caught
 * every LLM usage metric — `promptTokens` and friends came out as `[redacted]`,
 * making the model client's cost and latency logging useless. These are counts,
 * not credentials, and they are the whole point of that log line.
 */
const METRIC_KEY_ALLOWLIST = new Set([
  "prompttokens",
  "completiontokens",
  "totaltokens",
  "cachedprompttokens",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "maxtokens",
  "max_tokens",
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (METRIC_KEY_ALLOWLIST.has(lower)) return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Partially mask an email: `alice@example.com` → `a***e@example.com`.
 *
 * Keeps the domain and the first and last character of the local part, which is
 * enough to recognise an account you already know about while not being a usable
 * address list. Short local parts lose everything.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return REDACTED;

  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `***${domain}`;

  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Mask any address appearing inside a free-text message. */
function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_IN_TEXT, (match) => maskEmail(match));
}

/**
 * Shorten a long opaque identifier: keep enough to correlate, drop the rest.
 *
 * User ids are UUIDs and appear in almost every log line. A prefix is enough to
 * follow one user through a request; the whole value is a durable identifier that
 * does not need to live in a log aggregator.
 */
function truncateId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

const ID_KEY_PATTERNS = ["userid", "user_id", "createdbyid", "collaboratorid"];

function isIdKey(key: string): boolean {
  const lower = key.toLowerCase();
  return ID_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively redact a value for logging.
 *
 * Errors become `{ name, message }` — deliberately without the stack, which
 * routinely contains file paths and, for database errors, fragments of the failing
 * statement. Use `logger.error` with the error as `err` when you want the message;
 * attach a stack explicitly if you genuinely need one.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth limit]";

  if (value === null || value === undefined) return value;

  if (typeof value === "string") return maskEmailsInText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";

  if (value instanceof Error) {
    return { name: value.name, message: maskEmailsInText(value.message) };
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
      } else if (isIdKey(key) && typeof item === "string") {
        out[key] = truncateId(item);
      } else if (key.toLowerCase().includes("email") && typeof item === "string") {
        out[key] = maskEmail(item);
      } else {
        out[key] = redact(item, depth + 1);
      }
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

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

export type LogContext = Record<string, unknown>;

function emit(
  level: Exclude<LogLevel, "silent">,
  scope: string,
  message: string,
  context?: LogContext,
): void {
  if (!isEnabled(level)) return;

  const safeMessage = maskEmailsInText(message);
  const safeContext = context ? (redact(context) as LogContext) : undefined;

  // JSON in production so a shipper can parse it; readable text otherwise.
  if (process.env.NODE_ENV === "production") {
    const line = JSON.stringify({
      level,
      scope,
      message: safeMessage,
      ...(safeContext ? { context: safeContext } : {}),
      time: new Date().toISOString(),
    });
    console[level === "debug" ? "log" : level](line);
    return;
  }

  const prefix = `[${scope}]`;
  console[level === "debug" ? "log" : level](
    prefix,
    safeMessage,
    ...(safeContext && Object.keys(safeContext).length ? [safeContext] : []),
  );
}

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  child: (childScope: string) => Logger;
}

/**
 * A logger bound to a scope, which is the prefix that used to be written by hand
 * in every call (`"[auth]"`, `"[ws:rooms]"`, `"[publisher]"`).
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, context) => emit("debug", scope, message, context),
    info: (message, context) => emit("info", scope, message, context),
    warn: (message, context) => emit("warn", scope, message, context),
    error: (message, context) => emit("error", scope, message, context),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

/** Test seam: what level is currently in effect. */
export function currentLogLevel(): LogLevel {
  return configuredLevel();
}
