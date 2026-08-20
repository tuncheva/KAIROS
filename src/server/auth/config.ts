import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { env } from "~/env"
import { and, eq, isNull } from "drizzle-orm";
import * as argon2 from "argon2";
import { decodeAccountSwitchCookie, getCookieFromHeader, ACCOUNT_SWITCH_COOKIE } from "~/server/security/accountSwitch";
import {
  checkAuthRateLimit,
  clearAuthAttempts,
  createAuthRateLimitKey,
  recordAuthFailure,
} from "~/server/security/authRateLimit";

/**
 * Best-effort client IP for rate limiting.
 *
 * Trusts `x-forwarded-for` / `x-real-ip`, which is only meaningful when the app
 * sits behind a proxy that sets them; a client can otherwise spoof the header.
 * That's acceptable here because the per-email limit is the real guard and this
 * is a second axis, but it does mean the IP limit should not be relied on alone.
 */


import { getClientIp } from "~/server/http/clientIp";
import { createLogger } from "~/server/logger";

const log = createLogger("auth");
import { db } from "~/server/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "~/server/db/schema";


/**
 * Failed sign-ins before the account is locked, and for how long.
 *
 * Higher than the 5-attempt sliding window on purpose: the window handles bursts,
 * while this is the backstop for attempts spread out over hours or across deploys.
 * Set too low, a forgetful user locks themselves out of their own account.
 */
const MAX_LOGIN_FAILURES = 10;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

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
        password: { label: "Password", type: "password" },
      },
      /**
       * Switch to another account that has signed in on this browser.
       *
       * This used to accept a bare `userId` and hand back a full session — a
       * password-free login whose only credential was a cookie that survived
       * sign-out. Anyone with access to the browser profile could enumerate
       * previous users and become any of them. A Google-style switcher is only
       * safe with the re-authentication step, so that step is now mandatory:
       *
       *   1. the cookie must still list the target, un-expired (the cookie is
       *      HMAC-signed, so it establishes *which* accounts may be offered — it
       *      is not by itself authorization to enter one);
       *   2. the caller must present that account's password.
       *
       * Accounts with no password (OAuth-only) cannot re-authenticate here at
       * all and are refused, which sends the UI down the full sign-out and
       * sign-in path — a fresh OAuth round-trip, which is the equivalent proof.
       */
      async authorize(credentials, request) {
        const userId = credentials?.userId;
        const password = credentials?.password;
        if (typeof userId !== "string" || !userId) {
          return null;
        }
        if (typeof password !== "string" || password.length === 0) {
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

        // Same limiter as sign-in. Without it this endpoint would be a quieter
        // way to brute-force a password: the attacker already knows the userId is
        // valid, and each attempt costs the server 64MB of Argon2.
        const userKey = createAuthRateLimitKey("account_switch", userId);
        const ipKey = createAuthRateLimitKey(
          "account_switch_ip",
          getClientIp(request),
        );
        const [userBudget, ipBudget] = await Promise.all([
          checkAuthRateLimit(userKey),
          checkAuthRateLimit(ipKey),
        ]);
        if (!userBudget.allowed || !ipBudget.allowed) {
          return null;
        }

        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user?.password) {
          // No stored password: either the row is gone or this is an OAuth-only
          // account. Either way there is nothing to verify against here.
          await Promise.all([
            recordAuthFailure(userKey),
            recordAuthFailure(ipKey),
          ]);
          return null;
        }

        const valid = await argon2.verify(user.password, password);
        if (!valid) {
          await Promise.all([
            recordAuthFailure(userKey),
            recordAuthFailure(ipKey),
          ]);
          return null;
        }

        await Promise.all([
          clearAuthAttempts(userKey),
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
          log.warn("sign-in throttled", { email });
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

        // Durable lockout, on top of the in-memory window above. Without this a
        // restart or a second instance resets the attacker's budget; the columns
        // do not. Mirrors the reset-PIN lockout in `note.resetPasswordWithPin`.
        const now = new Date();
        if (user.loginLockedUntil && now < user.loginLockedUntil) {
          log.warn("sign-in locked out", { email });
          return null;
        }

        const isPasswordValid = await argon2.verify(
          user.password,
          credentials.password as string
        );

        if (!isPasswordValid) {
          const failedAttempts = user.loginFailedAttempts + 1;

          await Promise.all([
            recordAuthFailure(emailKey),
            recordAuthFailure(ipKey),
            db
              .update(users)
              .set({
                loginFailedAttempts: failedAttempts,
                loginLastFailedAt: now,
                // The window limiter already slows a burst; this catches the
                // patient attacker who spreads attempts across restarts.
                loginLockedUntil:
                  failedAttempts >= MAX_LOGIN_FAILURES
                    ? new Date(now.getTime() + LOGIN_LOCKOUT_MS)
                    : user.loginLockedUntil,
              })
              .where(eq(users.id, user.id)),
          ]);
          return null;
        }

        // The password is right, but an unconfirmed address is not yet proven to
        // belong to this person. Refusing here is what stops someone registering
        // an address they do not control and sitting on the account.
        //
        // Not counted as a failed attempt — the credential was correct, and
        // charging the limiter would let a confirmed-but-forgotten account lock
        // itself out while the user hunts for the email.
        if (!user.emailVerified) {
          log.warn("sign-in refused, email not confirmed", { email });
          return null;
        }

        await Promise.all([
          clearAuthAttempts(emailKey),
          clearAuthAttempts(ipKey),
          // Only clear the durable counter when the sign-in actually succeeds, so
          // a few mistyped passwords don't accumulate toward a lockout forever.
          user.loginFailedAttempts > 0 || user.loginLockedUntil
            ? db
                .update(users)
                .set({
                  loginFailedAttempts: 0,
                  loginLockedUntil: null,
                  loginLastFailedAt: null,
                })
                .where(eq(users.id, user.id))
            : Promise.resolve(),
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
    async signIn({ user, account, profile }) {
      const userId = user.id;
      const email = user.email;
      const name = user.name;
      const image = user.image;

      if (typeof email !== "string" || email.length === 0) return false;

      const isOAuth = account?.type === "oauth" || account?.type === "oidc";

      if (isOAuth) {
        // ── OAuth account linking ────────────────────────────────────────────
        //
        // `allowDangerousEmailAccountLinking` is still on, because turning it off
        // reintroduces the OAuthAccountNotLinked failure the comment on the Google
        // provider describes. What was missing is the condition that makes the
        // linking safe, and this is it.
        //
        // The attack it blocks: register `victim@company.com` with a password of
        // your choosing, wait for the real owner to sign in with Google, and the
        // provider identity attaches to your pre-existing row — your password now
        // opens their account. It works only because the row you created was never
        // confirmed to be yours.
        //
        // So: a provider identity may only attach to a row that is already
        // verified, and the provider must itself assert the address is verified.
        // Anything else is refused rather than linked.
        const providerVerifiesEmail = (() => {
          const claim = (profile as { email_verified?: unknown } | undefined)
            ?.email_verified;
          // Google sends a boolean; some providers send the string "true"; Entra on
          // the `common` tenant sends nothing at all, which counts as "not
          // asserted" and therefore only ever links to already-verified rows.
          return claim === true || claim === "true";
        })();

        // A provider account already stored for this identity means this is a
        // returning user, not a new link, so there is nothing to decide.
        const linkedAlready =
          account?.provider && account?.providerAccountId
            ? await db.query.accounts.findFirst({
                where: and(
                  eq(accounts.provider, account.provider),
                  eq(accounts.providerAccountId, account.providerAccountId),
                ),
                columns: { userId: true },
              })
            : undefined;

        const existingByEmail = await db.query.users.findFirst({
          where: eq(users.email, email),
          columns: { id: true, emailVerified: true },
        });

        if (!linkedAlready && existingByEmail && !existingByEmail.emailVerified) {
          log.warn("refused OAuth link into unverified account", { email });
          return false;
        }

        // The provider vouching for the address is proof, so record it. This also
        // upgrades rows created before verification existed.
        if (providerVerifiesEmail) {
          const target = linkedAlready?.userId ?? existingByEmail?.id;
          if (target) {
            await db
              .update(users)
              .set({ emailVerified: new Date(), updatedAt: new Date() })
              .where(and(eq(users.id, target), isNull(users.emailVerified)));
          }
        }
      }

      // Ensure the authenticated user exists in the app DB on every sign-in
      // (moved from protectedProcedure to avoid per-request DB checks).
      if (typeof userId === "string") {
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
              // A provider-created account is verified by the provider; a
              // credentials account gets here only after redeeming a token, and
              // `auth.signup` has already written the row by then.
              emailVerified: isOAuth ? new Date() : null,
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

      // `useSession().update(...)` lets the *client* hand values to this callback.
      //
      // This used to copy `email` and `name` straight from that payload into the
      // token, and the `session` callback then copied them onto `session.user`.
      // Any signed-in user could therefore call
      // `update({ user: { email: "someone@else" } })` and make their session claim
      // another identity — including to code that trusts `session.user.email`.
      //
      // So the client-supplied value is no longer trusted for anything identifying.
      // `image` is accepted because it is cosmetic and is what the avatar upload
      // flow needs to refresh immediately; `name` and `email` are re-read from the
      // database by `token.id`, which is the only claim established at sign-in.
      if (trigger === "update") {
        const nextUser = (
          session as { user?: { image?: unknown } } | undefined
        )?.user;

        if (typeof nextUser?.image === "string") token.image = nextUser.image;

        if (typeof token.id === "string") {
          const fresh = await db.query.users.findFirst({
            where: eq(users.id, token.id),
            columns: { name: true, email: true, image: true },
          });

          if (fresh) {
            token.name = fresh.name;
            token.email = fresh.email;
            // A client-supplied image only survives if the row has none yet, so a
            // stale upload cannot mask what the database says.
            if (typeof nextUser?.image !== "string") token.image = fresh.image;
          }
        }
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
        log.error("failed to clear account-switch cookie", { err });
      }
    },
  },

  pages: {
    signIn: "/",
  },
} satisfies NextAuthConfig;