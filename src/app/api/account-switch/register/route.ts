import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "~/env";
import { auth } from "~/server/auth";
import {
  ACCOUNT_SWITCH_COOKIE,
  ACCOUNT_SWITCH_ENTRY_TTL_MS,
  decodeAccountSwitchCookie,
  encodeAccountSwitchCookie,
  type AccountSwitchEntry,
} from "~/server/security/accountSwitch";

export async function POST() {
  if (!env.AUTH_SECRET) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const secret = env.AUTH_SECRET;
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cookieStore = await cookies();
  const existingValue = cookieStore.get(ACCOUNT_SWITCH_COOKIE)?.value;
  const existing = decodeAccountSwitchCookie(existingValue, secret);

  const nextEntry: AccountSwitchEntry = {
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
    lastUsed: Date.now(),
    expiresAt: Date.now() + ACCOUNT_SWITCH_ENTRY_TTL_MS,
  };

  const merged = [
    nextEntry,
    ...existing.filter((a) => a.userId !== nextEntry.userId),
  ]
    .slice(0, 8)
    .sort((a, b) => b.lastUsed - a.lastUsed);

  const value = encodeAccountSwitchCookie(merged, secret);

  cookieStore.set(ACCOUNT_SWITCH_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Matches the per-entry deadline stamped into the payload above. The payload
    // is the authority; this just stops the browser holding a cookie whose every
    // entry has already expired.
    maxAge: ACCOUNT_SWITCH_ENTRY_TTL_MS / 1000,
  });

  return NextResponse.json({ ok: true });
}
