import QRCode from "qrcode";

import { env } from "~/env";

/**
 * How long a freshly minted join QR stays scannable.
 *
 * Short on purpose: the QR is meant to be shown on a screen or a projector in
 * the room, scanned there and then, and be worthless in the photo somebody took
 * of it afterwards. Ten minutes covers "put it up, let the room scan it" without
 * leaving a usable credential lying around.
 */
export const JOIN_CODE_TTL_MS = 10 * 60 * 1000;

/** Rotation past this point is pointless — the code already died on its own. */
export function isExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * A URL-safe token with 130 bits of entropy.
 *
 * Crockford-style alphabet minus the characters that get mangled when someone
 * reads a code aloud or retypes it from a screen (I, L, O, U), because the same
 * token is the fallback for a device that cannot scan.
 */
const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
const TOKEN_LENGTH = 26;

export function generateJoinToken(): string {
  // 32 divides 256, so nothing is actually rejected today. The check stays so
  // the uniformity survives someone changing the alphabet length.
  const maxValid = 256 - (256 % TOKEN_ALPHABET.length);

  let token = "";
  while (token.length < TOKEN_LENGTH) {
    const bytes = new Uint8Array(TOKEN_LENGTH);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (token.length >= TOKEN_LENGTH) break;
      if (b >= maxValid) continue;
      token += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
    }
  }

  return token;
}

/**
 * The origin the QR should point at.
 *
 * Taken from the request rather than from configuration first: the person
 * scanning is standing next to the person showing, so the link has to land on
 * whatever host that browser is actually using (preview deploy, LAN address,
 * localhost) or the scan goes nowhere. `NEXT_PUBLIC_APP_URL` is the fallback for
 * calls that arrive without usable host headers.
 */
export function resolveOrigin(headers: Headers | null | undefined): string {
  const configured = env.NEXT_PUBLIC_APP_URL;

  const forwardedHost = headers?.get("x-forwarded-host");
  const host = forwardedHost ?? headers?.get("host");
  if (host) {
    const proto =
      headers?.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  }

  return configured ?? "http://localhost:3000";
}

export function buildJoinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/join/${encodeURIComponent(code)}`;
}

/**
 * Render the join URL as an inline SVG.
 *
 * Server-side and dependency-free at the client: the previous implementation
 * pointed an `<img>` at api.qrserver.com, which handed the invite link — a live
 * credential for the workspace — to a third party on every render.
 */
export async function renderJoinQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}
