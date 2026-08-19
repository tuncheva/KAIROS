/**
 * Security headers.
 *
 * The app had none: no CSP, no HSTS, no framing protection, no referrer policy.
 * It renders user-authored content (note bodies, chat messages, event comments)
 * and embeds third-party scripts, so a CSP is the main defence-in-depth that was
 * still on the table.
 *
 * Split across two mechanisms for a reason:
 *
 *  - The headers with no per-request component are static, and live in
 *    `config/next.config.js` via `staticSecurityHeaders()`.
 *  - The CSP needs a fresh nonce per response, so it is built in the proxy
 *    (`src/proxy.ts`), which is the only place that sees each request.
 *
 ## Enforced, with a rollback switch
 *
 * The policy blocks by default. Set `CSP_REPORT_ONLY=1` to downgrade it to
 * `Content-Security-Policy-Report-Only` — one variable, no deploy — if something
 * turns out to be blocked that should not be.
 *
 * ## What was actually exercised
 *
 * Enforcement was turned on only after loading the app and reading the violations,
 * which found two bugs that source review had not:
 *
 *  1. The inline theme script was given the per-response nonce. That produced both
 *     a CSP violation and a React hydration mismatch (`nonce="…"` server,
 *     `nonce=""` client), because React does not carry `nonce` into the client
 *     tree. It is allowed by hash now — see `~/server/themeInitScript`.
 *  2. `next-themes` injects a *second* inline script that nothing had accounted
 *     for. It takes a `nonce` prop, now threaded through `ThemeProvider`.
 *
 * Verified with zero violations: the marketing page, the sign-in modal, and
 * `/verify-email`. **Not** verified, because signing in was not possible during
 * that pass: the Google Maps region picker, UploadThing image uploads, and the
 * authenticated socket connection. Those hosts are in the allowlist below and
 * `strict-dynamic` covers scripts they inject at runtime, but if any of them turns
 * out to be blocked, set `CSP_REPORT_ONLY=1`, collect the violation, and add the
 * source it names.
 */

import { THEME_INIT_SCRIPT_SHA256 } from "~/server/themeInitScript";

/** Origins the browser genuinely needs to reach, by directive. */
const ALLOWLIST = {
  /** `@react-google-maps/api` loads the Maps JS SDK from here. */
  maps: ["https://maps.googleapis.com", "https://maps.gstatic.com"],
  /** UploadThing's client talks to its API and serves files from utfs.io. */
  uploads: [
    "https://uploadthing.com",
    "https://*.uploadthing.com",
    "https://utfs.io",
    "https://*.utfs.io",
    "https://*.ufs.sh",
  ],
  /** Avatars from Google OAuth, and the QR image endpoint used in settings. */
  images: ["https://lh3.googleusercontent.com", "https://api.qrserver.com"],
} as const;

/**
 * The WebSocket server. `connect-src` must name it explicitly — socket.io opens
 * both an HTTP polling connection and a `wss:` upgrade, and neither is covered by
 * `'self'` when the WS server runs on its own origin.
 */
function websocketOrigins(): string[] {
  const url = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";
  try {
    const { origin } = new URL(url);
    // Same host over the ws/wss scheme, for the upgrade.
    const wsOrigin = origin.replace(/^http/, "ws");
    return [origin, wsOrigin];
  } catch {
    return [];
  }
}

/**
 * Headers with no per-request component. Applied to every route from
 * `next.config.js`.
 */
export function staticSecurityHeaders(): { key: string; value: string }[] {
  return [
    // Belt and braces with the CSP's `frame-ancestors`, for browsers that see
    // this header but not the CSP.
    { key: "X-Frame-Options", value: "DENY" },

    // Stop content-type sniffing turning an uploaded file into a script.
    { key: "X-Content-Type-Options", value: "nosniff" },

    // Send the origin but not the path to other sites, so note and project URLs
    // do not leak through outbound links.
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },

    // Nothing in the app uses these. Denying them means an injected iframe or
    // script cannot ask for them either.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(self), payment=()",
    },

    // Two years, subdomains included. Only meaningful over HTTPS; browsers ignore
    // it on plain HTTP, so it is safe to send in development too. `preload` is
    // deliberately omitted — that is a one-way door and belongs to whoever owns
    // the domain, not to this config.
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
  ];
}

/**
 * Build the CSP for one response.
 *
 * @param nonce Per-response nonce. Next.js reads it back off this header and
 *   applies it to the script tags it generates itself, so hand-written inline
 *   scripts are the only ones that need it applied manually.
 */
export function contentSecurityPolicy(nonce: string): string {
  const ws = websocketOrigins();
  const isDev = process.env.NODE_ENV !== "production";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // `strict-dynamic` lets a nonce-approved script load further scripts, which
    // is how the Maps SDK bootstraps itself. Browsers that honour it ignore the
    // host allowlist; the hosts stay for those that don't.
    "script-src": [
      "'self'",
      // Next.js reads this nonce back out of the header and stamps it on the script
      // tags it generates itself.
      `'nonce-${nonce}'`,
      // The theme-flash script is static and allowed by hash instead. A nonce on it
      // caused both a CSP violation and a React hydration mismatch, because React
      // does not carry `nonce` into the client tree — see `~/server/themeInitScript`.
      THEME_INIT_SCRIPT_SHA256,
      "'strict-dynamic'",
      ...ALLOWLIST.maps,
      // React refresh and the dev overlay evaluate generated code.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],

    // GSAP and Tailwind arbitrary values both write inline styles, and there is
    // no nonce path for style attributes. This is the one place the policy stays
    // loose; it is also the least dangerous, since style injection cannot
    // execute code.
    "style-src": ["'self'", "'unsafe-inline'"],

    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...ALLOWLIST.images,
      ...ALLOWLIST.uploads,
      ...ALLOWLIST.maps,
    ],

    "font-src": ["'self'", "data:"],

    "connect-src": [
      "'self'",
      ...ws,
      ...ALLOWLIST.uploads,
      ...ALLOWLIST.maps,
      // The dev server's HMR socket.
      ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
    ],

    // Maps renders into an iframe on some code paths.
    "frame-src": ["'self'", ...ALLOWLIST.maps],

    "worker-src": ["'self'", "blob:"],

    // No plugins, and no way for an injected <base> to re-point every relative
    // URL in the document.
    "object-src": ["'none'"],
    "base-uri": ["'none'"],

    // Nothing should be framing this app.
    "frame-ancestors": ["'none'"],

    // Only submit forms back to ourselves.
    "form-action": ["'self'"],
  };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

/**
 * True when the CSP should block rather than merely report.
 *
 * Enforced by default: a report-only policy is diagnostics, not a control. The
 * escape hatch is opt-*out* so that a misconfigured environment fails toward
 * protection rather than away from it.
 */
export function isCspEnforced(): boolean {
  const reportOnly = process.env.CSP_REPORT_ONLY;
  return !(reportOnly === "1" || reportOnly === "true");
}

/** The header name to send the policy under, given the enforcement mode. */
export function cspHeaderName(): string {
  return isCspEnforced()
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}
