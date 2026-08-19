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
 * ## Report-Only by default
 *
 * The CSP ships as `Content-Security-Policy-Report-Only` unless `CSP_ENFORCE` is
 * set. An enforced CSP that has never been exercised against the running app is a
 * blank-page outage waiting to happen — Google Maps, UploadThing and GSAP all
 * inject at runtime, and the allowlist below is derived from reading the source,
 * not from watching the browser. Report-Only puts violations in the console where
 * they can be read, without breaking anything.
 *
 * To enforce: run the app with Report-Only, exercise the map picker, an image
 * upload, the chat, and an animated page; fix whatever is reported; then set
 * `CSP_ENFORCE=1`.
 */

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
      `'nonce-${nonce}'`,
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

/** True when the CSP should block rather than merely report. */
export function isCspEnforced(): boolean {
  return process.env.CSP_ENFORCE === "1" || process.env.CSP_ENFORCE === "true";
}

/** The header name to send the policy under, given the enforcement mode. */
export function cspHeaderName(): string {
  return isCspEnforced()
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}
