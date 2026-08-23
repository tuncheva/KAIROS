/**
 * The parts of the webhook contract that are pure: the signature scheme, and
 * which URLs may be posted to.
 *
 * Split from `webhooks.ts` because that module imports the database client, which
 * reads validated server env at load — so importing it from a unit test costs a
 * live configuration. These two functions are the security-critical half of the
 * feature and the half a receiver has to reimplement, which makes them exactly
 * the code that should be cheap to test.
 */

import "server-only";

import crypto from "node:crypto";

export function generateWebhookSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * The signature a receiver should verify.
 *
 * Exported and documented because the receiver has to reimplement it: sign
 * `{timestamp}.{body}`, compare in constant time, and reject a timestamp outside
 * your tolerance. Publishing the exact recipe is the difference between a
 * verifiable webhook and a header nobody checks.
 */
export function signPayload(input: {
  secret: string;
  timestamp: number;
  body: string;
}): string {
  return crypto
    .createHmac("sha256", input.secret)
    .update(`${String(input.timestamp)}.${input.body}`, "utf8")
    .digest("hex");
}

/**
 * Is this a URL we are willing to POST to?
 *
 * The check that stops a webhook being an SSRF primitive. A user who can register
 * `http://169.254.169.254/latest/meta-data/` has turned this feature into a way
 * to make the *server* fetch things it can reach and they cannot.
 *
 * Hostname-based and deliberately conservative. It does not resolve DNS, so it
 * cannot stop a hostname that resolves to a private address — closing that needs
 * resolution plus a re-check at connect time, which is a bigger change and is
 * noted rather than half-done here. What this does stop is the entire class of
 * literal-address attempts, which is what actually gets typed in.
 */
export function isAllowedWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // Plaintext HTTP would send the signature and payload in clear.
  if (url.protocol !== "https:") return false;

  // `URL.hostname` keeps the brackets on an IPv6 literal — `[fd00::1]` — so they
  // are stripped before any comparison. Getting this wrong is silent in both
  // directions: the IPv6 rules below never fire, *and* a bare `startsWith("fc")`
  // on the unstripped host would reject a perfectly ordinary hostname like
  // `fc-corp.com`.
  const hostname = url.hostname.toLowerCase();
  const isIpv6Literal = hostname.startsWith("[") && hostname.endsWith("]");
  const host = isIpv6Literal ? hostname.slice(1, -1) : hostname;

  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // The metadata endpoint of every major cloud, and the loopback/link-local
  // ranges generally.
  if (
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  ) {
    return false;
  }

  // IPv4 literals in private or reserved space.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    const [a, b] = [parts[0] ?? 0, parts[1] ?? 0];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a >= 224) return false;
  }

  // IPv6 loopback, unspecified, unique-local (fc00::/7) and link-local
  // (fe80::/10). Applied only to an actual IPv6 literal, so a hostname beginning
  // with those letters is unaffected.
  if (isIpv6Literal) {
    if (host === "::1" || host === "::") return false;
    // fc00::/7 covers fc and fd; fe80::/10 in practice starts fe8–feb.
    if (/^f[cd]/.test(host)) return false;
    if (/^fe[89ab]/.test(host)) return false;
    // An IPv4-mapped address is still that address.
    if (host.startsWith("::ffff:")) return false;
  }

  return true;
}
