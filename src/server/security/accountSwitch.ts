import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

export const ACCOUNT_SWITCH_COOKIE = "kairos.accounts";

/**
 * How long an entry stays switchable, independent of the cookie's own `maxAge`.
 *
 * The cookie lifetime alone is not a security boundary: a client controls when it
 * sends a cookie, and a copied cookie jar keeps working until the browser decides
 * otherwise. Stamping the deadline inside the signed payload means the server
 * decides, and the signature makes it untamperable.
 */
export const ACCOUNT_SWITCH_ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AccountSwitchEntry = {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
  lastUsed: number;
  /**
   * Epoch ms after which this entry is ignored. Entries written before this field
   * existed have no value and are treated as expired — failing closed costs those
   * users one extra sign-in and is the right direction for a credential.
   */
  expiresAt?: number;
};

type CookiePayloadV1 = {
  v: 1;
  accounts: AccountSwitchEntry[];
};

const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const base64UrlEncode = (raw: string) => Buffer.from(raw, "utf8").toString("base64url");
const base64UrlDecode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

export class AccountSwitchCookieCodec {
  constructor(private readonly secret: string) {}

  private sign(payloadB64: string) {
    return createHmac("sha256", this.secret).update(payloadB64).digest("base64url");
  }

  encode(accounts: AccountSwitchEntry[]) {
    const payload: CookiePayloadV1 = { v: 1, accounts };
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const sig = this.sign(payloadB64);
    return `${payloadB64}.${sig}`;
  }

  decode(value: string | undefined, now = Date.now()) {
    if (!value) return [] as AccountSwitchEntry[];

    const [payloadB64, sig] = value.split(".");
    if (!payloadB64 || !sig) return [] as AccountSwitchEntry[];

    const expected = this.sign(payloadB64);
    if (expected.length !== sig.length) return [] as AccountSwitchEntry[];

    try {
      const ok = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) return [] as AccountSwitchEntry[];
    } catch {
      return [] as AccountSwitchEntry[];
    }

    const payloadRaw = base64UrlDecode(payloadB64);
    const parsed = safeJsonParse(payloadRaw);
    if (!parsed || typeof parsed !== "object") return [] as AccountSwitchEntry[];

    const maybe = parsed as Partial<CookiePayloadV1>;
    if (maybe.v !== 1 || !Array.isArray(maybe.accounts)) return [] as AccountSwitchEntry[];

    return maybe.accounts
      .filter((a): a is AccountSwitchEntry => {
        if (!a || typeof a !== "object") return false;
        const x = a as Partial<AccountSwitchEntry>;
        return (
          typeof x.userId === "string" &&
          typeof x.email === "string" &&
          typeof x.lastUsed === "number" &&
          (typeof x.name === "string" || x.name === null || x.name === undefined) &&
          (typeof x.image === "string" || x.image === null || x.image === undefined)
        );
      })
      .filter((a) => typeof a.expiresAt === "number" && a.expiresAt > now)
      .sort((a, b) => b.lastUsed - a.lastUsed);
  }

  static getCookieFromHeader(cookieHeader: string | null, name: string) {
    if (!cookieHeader) return undefined;
    const parts = cookieHeader.split(";");
    for (const part of parts) {
      const [k, ...rest] = part.trim().split("=");
      if (!k) continue;
      if (k === name) return rest.join("=");
    }
    return undefined;
  }
}

export const encodeAccountSwitchCookie = (accounts: AccountSwitchEntry[], secret: string) => {
  return new AccountSwitchCookieCodec(secret).encode(accounts);
};

export const decodeAccountSwitchCookie = (
  value: string | undefined,
  secret: string,
  now = Date.now(),
) => {
  return new AccountSwitchCookieCodec(secret).decode(value, now);
};

export const getCookieFromHeader = (cookieHeader: string | null, name: string) => {
  return AccountSwitchCookieCodec.getCookieFromHeader(cookieHeader, name);
};
