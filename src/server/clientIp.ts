/**
 * Best-effort client IP, for use as a second rate-limit dimension.
 *
 * Trusts `x-forwarded-for` / `x-real-ip`, which is only meaningful when the app
 * sits behind a proxy that sets them — a direct client can otherwise send
 * whatever it likes. So an IP-keyed limit must never be the *only* guard: it is
 * there to stop one source hammering many identities, while the per-identity
 * limit stops many sources hammering one. Neither alone is sufficient.
 *
 * Returns the literal string `"unknown"` when no header is present, which
 * deliberately groups all such callers into one shared budget rather than giving
 * each an unlimited one.
 */
export function getClientIp(
  source: Headers | Request | undefined | null,
): string {
  const headers =
    source instanceof Headers ? source : (source?.headers ?? null);
  if (!headers) return "unknown";

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return headers.get("x-real-ip") ?? "unknown";
}
