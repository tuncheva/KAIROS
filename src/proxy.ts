import { NextResponse, type NextRequest } from "next/server";

import {
  contentSecurityPolicy,
  cspHeaderName,
  staticSecurityHeaders,
} from "~/server/http/securityHeaders";

/**
 * Centralized Next.js proxy for route protection and security headers.
 *
 * Migrated from middleware.ts → proxy.ts per Next.js 16 deprecation:
 * https://nextjs.org/docs/messages/middleware-to-proxy
 *
 * IMPORTANT: This runs in the Edge Runtime so it CANNOT import Node.js modules
 * (node:crypto, argon2, etc.). Instead of calling the full `auth()` helper we
 * check for the presence of the NextAuth session-token cookie. The actual
 * session validation still happens server-side in `auth()` / `protectedProcedure`.
 *
 * Every response leaves here with the security headers attached — including
 * redirects, so a browser following one still gets the framing and transport
 * rules. See `~/server/http/securityHeaders` for what is set and why the CSP starts in
 * report-only mode.
 */

// Cookie names NextAuth v5 uses (JWT strategy)
const SESSION_COOKIE = "authjs.session-token";
const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";

// Routes that do NOT require authentication
// `/verify-email` must be reachable without a session: the token in the link *is*
// the credential, and credentials sign-in is refused until it is redeemed, so
// requiring a session here would make confirmation impossible.
// Note recovery is deliberately not here either. It now lives at
// `/notes/[noteId]/recover` under `(app)`, so the shell's own session check
// sends an unauthenticated visitor to sign in with a `callbackUrl` back to the
// form — which is what the page needs anyway, since the PIN it checks belongs
// to a user and every procedure it calls is a `protectedProcedure`.
const PUBLIC_PATHS = new Set([
  "/",
  "/api/auth",
  "/verify-email",
  // A failed sign-in has, by definition, no session cookie. Gating the page that
  // explains the failure sent it back to `/` with the error code buried in a
  // query string nothing reads — the dead end this page exists to end.
  "/auth-error",
  // The footer and the consent line under the sign-up button link here. A visitor
  // has to be able to read what they are agreeing to *before* they have a session,
  // so these cannot sit behind the cookie gate.
  "/privacy",
  "/terms",
  "/security",
  "/about",
  "/contact",
  "/careers",
]);

/**
 * File extensions that belong to static assets.
 *
 * The rule here used to be `pathname.includes(".")`, which treated *any* path
 * containing a dot as public — so a route like `/orgs/acme.co/settings` skipped the
 * session check entirely. Matching a known extension at the end of the path is the
 * same convenience without the hole.
 *
 * This is defence in depth rather than the real gate: `protectedProcedure` and
 * `auth()` authorize every request that matters. The Edge runtime cannot call
 * `auth()`, so this file can only ever check for the presence of a cookie.
 */
const STATIC_ASSET_EXTENSIONS = new Set([
  "ico", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp",
  "css", "js", "mjs", "map",
  "woff", "woff2", "ttf", "otf", "eot",
  "json", "txt", "xml", "webmanifest",
  "mp4", "webm", "mp3", "wav", "ogg",
  "pdf",
]);

function isStaticAsset(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0) return false;
  return STATIC_ASSET_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // An event page is meant to be pasted into a group chat. Gating it behind the
  // session cookie would mean every shared link greeted the person who received
  // it with a sign-in wall, which is the opposite of what publishing is for.
  if (pathname.startsWith("/events/")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/trpc")) return true;
  if (pathname.startsWith("/api/account-switch")) return true;
  if (pathname.startsWith("/api/uploadthing")) return true;
  /* The subscribable calendar feed. Google, Apple and Outlook fetch it from
     their own servers on their own schedule, so there is no cookie to gate on
     — the 64-character token in the path is the credential, and the route
     checks it before it reads anything. */
  if (pathname.startsWith("/api/calendar/feed/")) return true;
  // Machine-to-machine routes. These carry no session cookie by design — they
  // authenticate with the shared ws credential, compared in constant time inside
  // the route handler, and a missing credential closes them rather than opening
  // them.
  // Without this the cookie gate redirected the ws-server's scheduler POST to
  // `/`, which fetch followed to a 200 HTML page — so every tick logged
  // "could not reach the app" while the app was up and the sweep never ran.
  if (pathname.startsWith("/api/internal")) return true;
  if (pathname.startsWith("/_next")) return true;
  if (isStaticAsset(pathname)) return true;
  return false;
}

/**
 * A fresh nonce per response.
 *
 * `crypto.getRandomValues` rather than `node:crypto`, because this file runs on
 * the Edge runtime where the Node built-ins are unavailable.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Attach the security headers to a response.
 *
 * The nonce also goes back on the response as `x-nonce`. Next.js reads the nonce
 * out of the CSP header to stamp its own generated script tags; `x-nonce` is for
 * our own inline scripts, which read it via `headers()` in a server component
 * (see the theme-flash script in `src/app/layout.tsx`).
 */
function withSecurityHeaders(
  response: NextResponse,
  nonce: string,
): NextResponse {
  for (const { key, value } of staticSecurityHeaders()) {
    response.headers.set(key, value);
  }
  response.headers.set(cspHeaderName(), contentSecurityPolicy(nonce));
  response.headers.set("x-nonce", nonce);
  return response;
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = generateNonce();

  // Forward the nonce on the *request* too, so server components rendering this
  // request can read it out of `headers()`.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const proceed = () =>
    withSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
    );

  if (isPublicPath(pathname)) {
    return proceed();
  }

  // Check for session cookie (works for both dev http and prod https)
  const hasSession =
    req.cookies.has(SESSION_COOKIE) || req.cookies.has(SECURE_SESSION_COOKIE);

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("callbackUrl", pathname);
    return withSecurityHeaders(NextResponse.redirect(url), nonce);
  }

  return proceed();
}

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
