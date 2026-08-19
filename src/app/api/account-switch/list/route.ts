import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { inArray } from "drizzle-orm";
import {
  ACCOUNT_SWITCH_COOKIE,
  decodeAccountSwitchCookie,
} from "~/server/accountSwitch";

export async function GET() {
  if (!env.AUTH_SECRET) {
    return NextResponse.json({ accounts: [] });
  }

  // This endpoint discloses the email, name and user id of every account that
  // has signed in on this browser, and those ids are exactly what the
  // `account-switch` credentials provider accepts. It must never answer an
  // unauthenticated request.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = env.AUTH_SECRET;
  const cookieStore = await cookies();
  const value = cookieStore.get(ACCOUNT_SWITCH_COOKIE)?.value;
  const accounts = decodeAccountSwitchCookie(value, secret);

  if (accounts.length === 0) {
    return NextResponse.json({ accounts: [] });
  }

  // Filter out accounts that no longer exist in the database
  const userIds = accounts.map(a => a.userId);
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, userIds));

  const existingUserIds = new Set(existingUsers.map(u => u.id));
  const filteredAccounts = accounts.filter(a => existingUserIds.has(a.userId));

  return NextResponse.json({ accounts: filteredAccounts });
}
