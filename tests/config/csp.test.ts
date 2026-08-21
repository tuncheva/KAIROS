import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import {
  THEME_INIT_SCRIPT,
  THEME_INIT_SCRIPT_HASH,
  THEME_INIT_SCRIPT_SHA256,
} from "~/server/http/themeInitScript";
import {
  contentSecurityPolicy,
  cspHeaderName,
  isCspEnforced,
  staticSecurityHeaders,
} from "~/server/http/securityHeaders";

/**
 * Tests for the Content-Security-Policy.
 *
 * The hash test is the important one: the inline theme script is allowed by hash
 * rather than nonce (see `~/server/http/themeInitScript` for why), and a hash that has
 * drifted from the script silently blocks it. This recomputes the pair, and fails
 * with the value to paste in.
 */

describe("theme init script hash", () => {
  it("matches the script it is supposed to allow", () => {
    const actual = `sha256-${createHash("sha256")
      .update(THEME_INIT_SCRIPT, "utf8")
      .digest("base64")}`;

    expect(
      actual,
      `THEME_INIT_SCRIPT changed. Set THEME_INIT_SCRIPT_HASH to: ${actual}`,
    ).toBe(THEME_INIT_SCRIPT_HASH);
  });

  it("is single-quoted in the source expression", () => {
    // Unquoted, Chrome reports "invalid source ... It will be ignored" and blocks
    // the script anyway. This was a real bug, caught only by loading the page.
    expect(THEME_INIT_SCRIPT_SHA256).toBe(`'${THEME_INIT_SCRIPT_HASH}'`);
  });
});

describe("contentSecurityPolicy", () => {
  const nonce = "test-nonce";
  const policy = contentSecurityPolicy(nonce);

  it("carries the per-response nonce, which Next reads back for its own scripts", () => {
    expect(policy).toContain(`'nonce-${nonce}'`);
  });

  it("allows the inline theme script by hash", () => {
    expect(policy).toContain(THEME_INIT_SCRIPT_SHA256);
  });

  it("does not allow arbitrary inline script", () => {
    // The whole point: an injected <script> without the nonce or hash must fail.
    const scriptSrc = policy
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"))!;

    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("refuses framing and plugin content, and pins base-uri", () => {
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
  });

  it("allows the hosts the app actually loads from", () => {
    // Derived from reading the source: Maps SDK, UploadThing, Google avatars.
    for (const host of [
      "https://maps.googleapis.com",
      "https://uploadthing.com",
      "https://lh3.googleusercontent.com",
    ]) {
      expect(policy).toContain(host);
    }
  });

  it("no longer reaches a third party to draw invite QR codes", () => {
    // Invite links are bearer credentials for a workspace. They were being handed
    // to api.qrserver.com on every render; the codes are rendered on our own
    // server now, so the host has no business being reachable.
    expect(policy).not.toContain("api.qrserver.com");
  });

  it("names the websocket origin in connect-src", () => {
    // socket.io opens an HTTP poll and a wss upgrade; neither is covered by 'self'
    // when the WS server runs on its own origin.
    const connectSrc = policy
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("connect-src"))!;

    expect(connectSrc).toMatch(/ws:\/\/|wss:\/\//);
  });

  it("keeps style-src loose, and says so", () => {
    // GSAP and Tailwind arbitrary values write inline styles and there is no nonce
    // path for style attributes. Pinned as a deliberate exception.
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  });
});

describe("enforcement mode", () => {
  it("picks the header name from the enforcement flag", () => {
    expect(cspHeaderName()).toBe(
      isCspEnforced()
        ? "Content-Security-Policy"
        : "Content-Security-Policy-Report-Only",
    );
  });
});

describe("staticSecurityHeaders", () => {
  it("sets the headers that need no per-request value", () => {
    const headers = new Map(staticSecurityHeaders().map((h) => [h.key, h.value]));

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("does not send HSTS preload, which is a one-way door", () => {
    const hsts = staticSecurityHeaders().find(
      (h) => h.key === "Strict-Transport-Security",
    )!;
    expect(hsts.value).not.toContain("preload");
  });
});
