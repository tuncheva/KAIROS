import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { env } from "~/env"
import { eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { decodeAccountSwitchCookie, getCookieFromHeader, ACCOUNT_SWITCH_COOKIE } from "~/server/accountSwitch";
import {
  checkAuthRateLimit,
  clearAuthAttempts,
  createAuthRateLimitKey,
  recordAuthFailure,
} from "~/server/authRateLimit";

/**
 * Best-effort client IP for rate limiting.
 *
 * Trusts `x-forwarded-for` / `x-real-ip`, which is only meaningful when the app
 * sits behind a proxy that sets them; a client can otherwise spoof the header.
 * That's acceptable here because the per-email limit is the real guard and this
 * is a second axis, but it does mean the IP limit should not be relied on alone.
 */


import { getClientIp } from "~/server/clientIp";
import { db } from "~/server/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "~/server/db/schema";


declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    
    } & DefaultSession["user"];
  }
}


export const authConfig = {
  secret: env.AUTH_SECRET,
  trustHost: true,


  session: {
    strategy: "jwt" as const,
  },
  
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      // Use state-based CSRF instead of PKCE to avoid cookie-parsing issues
      // (InvalidCheck: pkceCodeVerifier) in dev / cross-browser scenarios.
      checks: ["state"],
      // Allow linking Google OAuth to an existing credentials account with the
      // same email. Without this, browsers that partition cookies differently
      // (e.g. Edge) throw OAuthAccountNotLinked when a user has both a
      // credentials account and attempts Google sign-in with the same email.
      allowDangerousEmailAccountLinking: true,
    }),
    MicrosoftEntraID({
      clientId: env.AUTH_MICROSOFT_ID,
      clientSecret: env.AUTH_MICROSOFT_SECRET,
      // Use "common" tenant to allow personal MS accounts + work/school accounts
      issuer: "https://login.microsoftonline.com/common/v2.0",
      authorization: {
        params: {
          scope: "openid profile email User.Read",
        },
      },
      checks: ["state"],
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      id: "account-switch",
      name: "account-switch",
      credentials: {
        userId: { label: "User ID", type: "text" },
      },
      async authorize(credentials, request) {
        const userId = credentials?.userId;
        if (typeof userId !== "string" || !userId) {
          return null;
        }

        if (!env.AUTH_SECRET) {
          return null;
        }

        const cookieHeader = request.headers.get("cookie");
        const cookieValue = getCookieFromHeader(cookieHeader, ACCOUNT_SWITCH_COOKIE);
        const accountsFromCookie = decodeAccountSwitchCookie(cookieValue, env.AUTH_SECRET);
        const allowed = accountsFromCookie.some((a) => a.userId === userId);
        if (!allowed) {
          return null;
        }

        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = (credentials.email as string).toLowerCase();

        // Brute-force protection. Sign-in does not go through tRPC, so the
        // limiter guarding the auth router never covered this path: password
        // guessing here was completely unbounded. Each attempt also runs Argon2id
        // at 64MB, so an unthrottled flood is a memory-exhaustion vector as much
        // as a credential-stuffing one.
        //
        // Limited on two axes so that neither a single account nor a single
        // source can be hammered. Only failures count (see recordAuthFailure).
        const emailKey = createAuthRateLimitKey("login", email);
        const ipKey = createAuthRateLimitKey("login_ip", getClientIp(request));

        const [emailBudget, ipBudget] = await Promise.all([
          checkAuthRateLimit(emailKey),
          checkAuthRateLimit(ipKey),
        ]);

        if (!emailBudget.allowed || !ipBudget.allowed) {
          // Deliberately the same generic failure as a wrong password: telling a
          // caller they've been throttled confirms the account exists.
          console.warn(`[auth] sign-in throttled for ${email}`);
          return null;
        }

        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (!user?.password) {
          // Count misses too, so the endpoint can't be used to enumerate which
          // addresses have credentials accounts.
          await Promise.all([
            recordAuthFailure(emailKey),
            recordAuthFailure(ipKey),
          ]);
          return null;
        }

        const isPasswordValid = await argon2.verify(
          user.password,
          credentials.password as string
        );

        if (!isPasswordValid) {
          await Promise.all([
            recordAuthFailure(emailKey),
            recordAuthFailure(ipKey),
          ]);
          return null;
        }

        await Promise.all([
          clearAuthAttempts(emailKey),
          clearAuthAttempts(ipKey),
        ]);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  
  callbacks: {
    async signIn({ user }) {
      // Ensure the authenticated user exists in the app DB on every sign-in
      // (moved from protectedProcedure to avoid per-request DB checks).
      const userId = user.id;
      const email = user.email;
      const name = user.name;
      const image = user.image;

      if (typeof userId === "string" && typeof email === "string" && email.length > 0) {
        const exists = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { id: true },
        });

        if (!exists) {
          await db
            .insert(users)
            .values({
              id: userId,
              email,
              name: typeof name === "string" ? name : null,
              image: typeof image === "string" ? image : null,
            })
            .onConflictDoNothing({ target: users.id });
        }
      }

      return true;
    },

    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        // Keep these in the token so session.strategy="jwt" can reflect updates.
        token.name = user.name;
        token.email = user.email;
        token.image = user.image;
      }

      // Allow `useSession().update(...)` to refresh token fields (e.g., image) on demand.
      if (trigger === "update") {
        const nextUser = (
          session as
            | { user?: { name?: unknown; email?: unknown; image?: unknown } }
            | undefined
        )?.user;

        if (typeof nextUser?.name === "string") token.name = nextUser.name;
        if (typeof nextUser?.email === "string") token.email = nextUser.email;
        if (typeof nextUser?.image === "string") token.image = nextUser.image;
      }

      return token;
    },
    
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.id === "string") session.user.id = token.id;
        if (typeof token.name === "string") session.user.name = token.name;
        if (typeof token.email === "string") session.user.email = token.email;
        if (typeof token.image === "string") session.user.image = token.image;
      }

      return session;
    },
  },
  
  events: {
    /**
     * Drop the account-switch cookie on sign-out.
     *
     * That cookie is the sole credential the `account-switch` provider accepts:
     * any user id listed in it can be signed in as, with no password. Left in
     * place after sign-out it meant anyone with access to the browser profile
     * could enumerate previous users via /api/account-switch/list and resume
     * their session for the cookie's full 30-day lifetime.
     *
     * The in-session switcher is unaffected — it calls signIn("account-switch")
     * directly rather than signing out first, and re-registers the cookie on the
     * next authenticated page load.
     */
    async signOut() {
      try {
        // Awaited, not fire-and-forget: the deletion has to be applied to the
        // cookie store before the sign-out response headers are written, or the
        // Set-Cookie never reaches the browser. `cookies()` is writable here
        // because this event runs inside the NextAuth route handler.
        const store = await cookies();
        store.delete(ACCOUNT_SWITCH_COOKIE);
      } catch (err) {
        // Never let cookie cleanup break sign-out itself.
        console.error("[auth] failed to clear account-switch cookie", err);
      }
    },
  },

  pages: {
    signIn: "/",
  },
} satisfies NextAuthConfig;