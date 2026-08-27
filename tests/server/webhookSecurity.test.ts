/**
 * Webhooks: the URL guard and the signature.
 *
 * A webhook is a request *this server* makes to an address *a user chose*, which
 * makes it an SSRF primitive unless something stops it. The interesting tests are
 * therefore all rejections: someone who registers
 * `http://169.254.169.254/latest/meta-data/` has turned a convenience feature
 * into a way to make the server fetch things it can reach and they cannot.
 *
 * The signature tests exist because the receiver has to reimplement the scheme.
 * If the timestamp is not inside the signed material, a captured delivery can be
 * replayed against the endpoint indefinitely — so that property is asserted
 * directly rather than assumed from the fact that a timestamp header is sent.
 */

import { describe, expect, it } from "vitest";

import {
  generateWebhookSecret,
  isAllowedWebhookUrl,
  signPayload,
} from "~/server/api/webhookSecurity";

describe("isAllowedWebhookUrl — rejections", () => {
  it("refuses plaintext HTTP", () => {
    // The signature and the payload would travel in clear.
    expect(isAllowedWebhookUrl("http://example.com/hook")).toBe(false);
  });

  it("refuses the cloud metadata endpoint", () => {
    // The canonical SSRF target: credentials, on an unauthenticated HTTP endpoint,
    // reachable only from inside.
    expect(isAllowedWebhookUrl("https://169.254.169.254/latest/meta-data/")).toBe(
      false,
    );
    expect(isAllowedWebhookUrl("https://metadata.google.internal/x")).toBe(false);
  });

  it("refuses loopback", () => {
    expect(isAllowedWebhookUrl("https://localhost/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://127.0.0.1/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://[::1]/hook")).toBe(false);
  });

  it("refuses RFC1918 private ranges", () => {
    expect(isAllowedWebhookUrl("https://10.0.0.5/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://192.168.1.10/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://172.16.0.1/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://172.31.255.254/hook")).toBe(false);
  });

  it("allows public addresses that merely look adjacent to private ones", () => {
    // 172.15 and 172.32 are outside the private block. Over-blocking would make
    // the feature unusable for legitimate hosts and is its own bug.
    expect(isAllowedWebhookUrl("https://172.15.0.1/hook")).toBe(true);
    expect(isAllowedWebhookUrl("https://172.32.0.1/hook")).toBe(true);
  });

  it("refuses link-local and multicast", () => {
    expect(isAllowedWebhookUrl("https://169.254.10.10/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://224.0.0.1/hook")).toBe(false);
  });

  it("refuses IPv6 unique-local and link-local", () => {
    // `URL.hostname` keeps the brackets on an IPv6 literal, so a naive
    // `startsWith("fd")` never fires. This caught exactly that.
    expect(isAllowedWebhookUrl("https://[fd00::1]/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://[fc00::1]/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://[fe80::1]/hook")).toBe(false);
  });

  it("refuses an IPv4-mapped IPv6 loopback", () => {
    expect(isAllowedWebhookUrl("https://[::ffff:127.0.0.1]/hook")).toBe(false);
  });

  it("allows a hostname that merely starts with those letters", () => {
    // The mirror bug: applying the IPv6 prefix rules to the raw host would
    // reject ordinary domains.
    expect(isAllowedWebhookUrl("https://fc-corp.example.com/hook")).toBe(true);
    expect(isAllowedWebhookUrl("https://fdn.example.com/hook")).toBe(true);
  });

  it("refuses .internal hostnames", () => {
    expect(isAllowedWebhookUrl("https://vault.internal/hook")).toBe(false);
  });

  it("refuses anything that is not a URL", () => {
    expect(isAllowedWebhookUrl("not a url")).toBe(false);
    expect(isAllowedWebhookUrl("")).toBe(false);
  });

  it("is not fooled by casing", () => {
    expect(isAllowedWebhookUrl("https://LOCALHOST/hook")).toBe(false);
  });
});

describe("isAllowedWebhookUrl — acceptances", () => {
  it("allows an ordinary HTTPS endpoint", () => {
    expect(isAllowedWebhookUrl("https://hooks.example.com/kairos")).toBe(true);
  });

  it("allows a port and a query string", () => {
    expect(isAllowedWebhookUrl("https://example.com:8443/hook?k=1")).toBe(true);
  });
});

describe("signPayload", () => {
  const base = { secret: "s3cret", timestamp: 1_770_000_000_000, body: '{"a":1}' };

  it("is deterministic for the same inputs", () => {
    expect(signPayload(base)).toBe(signPayload(base));
  });

  it("changes when the body changes", () => {
    expect(signPayload({ ...base, body: '{"a":2}' })).not.toBe(
      signPayload(base),
    );
  });

  it("changes when the timestamp changes", () => {
    // The anti-replay property. If the timestamp were only a header and not part
    // of the signed material, a captured delivery could be replayed forever.
    expect(signPayload({ ...base, timestamp: base.timestamp + 1 })).not.toBe(
      signPayload(base),
    );
  });

  it("changes when the secret changes", () => {
    expect(signPayload({ ...base, secret: "other" })).not.toBe(signPayload(base));
  });

  it("produces a hex SHA-256 digest", () => {
    expect(signPayload(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not let body and timestamp be confused for one another", () => {
    // Concatenating without a separator would make ("1", "23") and ("12", "3")
    // sign identically. The delimiter is what stops that.
    const a = signPayload({ secret: "s", timestamp: 1, body: "23" });
    const b = signPayload({ secret: "s", timestamp: 12, body: "3" });

    expect(a).not.toBe(b);
  });
});

describe("generateWebhookSecret", () => {
  it("returns a URL-safe high-entropy string", () => {
    const secret = generateWebhookSecret();

    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("does not repeat", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateWebhookSecret()),
    );
    expect(seen.size).toBe(50);
  });
});
