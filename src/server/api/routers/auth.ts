import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { users, passwordResetCodes } from "~/server/db/schema";
import { eq, and, gt } from "drizzle-orm";
import * as argon2 from "argon2";
import { TRPCError } from "@trpc/server";
import { sendWelcomeEmail, sendPasswordResetCode, sendEmailVerification } from "~/server/email/email";
import {
  consumeVerificationToken,
  issueVerificationToken,
} from "~/server/email/emailVerification";
import crypto from "node:crypto";
import { consumeAuthRateLimit, createAuthRateLimitKey } from "~/server/security/authRateLimit";
import { getClientIp } from "~/server/http/clientIp";
import { createLogger } from "~/server/logger";

const log = createLogger("auth.router");

function generateResetCode(): string {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0) % 90000000 + 10000000;
  return num.toString();
}

export const authRouter = createTRPCRouter({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters"),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { email, password, name } = input;

      // Rate limit by email to prevent signup spam, and by IP so one source
      // cannot enumerate addresses by signing up as each of them in turn.
      await consumeAuthRateLimit(createAuthRateLimitKey("signup", email));
      await consumeAuthRateLimit(
        createAuthRateLimitKey("signup_ip", getClientIp(ctx.headers)),
      );

      const existingUser = await ctx.db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User with this email already exists",
        });
      }

      const hashedPassword = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      // Unverified until a token is redeemed. This used to be `new Date()` with no
      // mail sent, which made the column meaningless and left OAuth linking able
      // to attach a real owner's provider identity to a row someone else created
      // with their address.
      const [newUser] = await ctx.db
        .insert(users)
        .values({
          email,
          password: hashedPassword,
          name: name ?? null,
          emailVerified: null,
        })
        .returning();

      const verifyToken = await issueVerificationToken(ctx.db, email);

      // Sent before the welcome mail because it is the one the user needs: sign-in
      // is refused until the address is confirmed.
      void sendEmailVerification({
        email,
        userName: name ?? email,
        verifyToken,
      }).catch((err) => {
        log.error("failed to send verification email", { email, err });
      });

      void sendWelcomeEmail({
        email,
        userName: name ?? email,
      }).catch((err) => {
        log.error("failed to send welcome email", { email, err });
      });

      return {
        success: true,
        userId: newUser?.id,
        verificationRequired: true,
      };
    }),

  /**
   * Redeem a verification token from the emailed link.
   *
   * Public by design: the holder of the token is the person being authenticated,
   * and there is no session yet.
   */
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      await consumeAuthRateLimit(
        createAuthRateLimitKey("verify_email_ip", getClientIp(ctx.headers)),
      );

      const result = await consumeVerificationToken(ctx.db, input.token);

      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            result.reason === "expired"
              ? "This confirmation link has expired. Request a new one."
              : "This confirmation link is not valid.",
        });
      }

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, result.email),
        columns: { id: true, emailVerified: true },
      });

      if (!user) {
        // The token was valid but the account is gone. Nothing to confirm.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This confirmation link is not valid.",
        });
      }

      if (!user.emailVerified) {
        await ctx.db
          .update(users)
          .set({ emailVerified: new Date(), updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }

      return { success: true, email: result.email };
    }),

  /**
   * Send a fresh confirmation link.
   *
   * Always reports success, so this cannot be used to discover which addresses
   * have accounts or which are already confirmed.
   */
  resendVerification: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();

      await consumeAuthRateLimit(
        createAuthRateLimitKey("resend_verification_ip", getClientIp(ctx.headers)),
      );
      await consumeAuthRateLimit(
        createAuthRateLimitKey("resend_verification", email),
      );

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, email),
        columns: { name: true, emailVerified: true },
      });

      if (user && !user.emailVerified) {
        const verifyToken = await issueVerificationToken(ctx.db, email);
        void sendEmailVerification({
          email,
          userName: user.name ?? email,
          verifyToken,
        }).catch((err) => {
          log.error("failed to resend verification email", { email, err });
        });
      }

      return { success: true };
    }),

  requestPasswordReset: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { email } = input;

      // Rate limit password reset requests to prevent email spam
      // Two dimensions, deliberately.
      //
      // Keyed on email alone, five requests locked a *specific user* out of
      // password recovery for fifteen minutes at a time — a denial of service
      // against the victim, using a limiter meant to protect them. The IP key is
      // what actually costs an attacker something, while the email key still caps
      // how much mail one address can be sent.
      await consumeAuthRateLimit(
        createAuthRateLimitKey("reset_request_ip", getClientIp(ctx.headers)),
      );
      await consumeAuthRateLimit(createAuthRateLimitKey("reset_request", email));

      // Always return success to prevent email enumeration
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user) {
        // Don't reveal that the user doesn't exist
        return { success: true };
      }

      const code = generateResetCode();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Issuing a new code retires any earlier ones, so only the most recent
      // code is ever valid. Previously each request just inserted another row.
      await ctx.db
        .update(passwordResetCodes)
        .set({ used: true })
        .where(
          and(
            eq(passwordResetCodes.email, email),
            eq(passwordResetCodes.used, false),
          ),
        );

      // Store the code in the database
      await ctx.db.insert(passwordResetCodes).values({
        email,
        code,
        expiresAt,
      });

      // Send the code via email
      try {
        await sendPasswordResetCode({
          email,
          userName: user.name ?? email,
          code,
        });
      } catch (err) {
        log.error("failed to send password reset code", { err });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send reset code. Please try again.",
        });
      }

      return { success: true };
    }),

  verifyResetCode: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        code: z.string().length(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { email, code } = input;

      // Rate limit code verification to prevent brute-force attacks
      await consumeAuthRateLimit(
        createAuthRateLimitKey("verify_code_ip", getClientIp(ctx.headers)),
      );
      await consumeAuthRateLimit(createAuthRateLimitKey("verify_code", email));

      const resetCode = await ctx.db.query.passwordResetCodes.findFirst({
        where: and(
          eq(passwordResetCodes.email, email),
          eq(passwordResetCodes.code, code),
          eq(passwordResetCodes.used, false),
          gt(passwordResetCodes.expiresAt, new Date()),
        ),
      });

      if (!resetCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired reset code",
        });
      }

      return { success: true };
    }),

  resetPassword: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        code: z.string().length(8),
        newPassword: z.string().min(8, "Password must be at least 8 characters"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { email, code, newPassword } = input;

      // Rate limit password resets
      await consumeAuthRateLimit(
        createAuthRateLimitKey("reset_password_ip", getClientIp(ctx.headers)),
      );
      await consumeAuthRateLimit(createAuthRateLimitKey("reset_password", email));

      // Verify the code again
      const resetCode = await ctx.db.query.passwordResetCodes.findFirst({
        where: and(
          eq(passwordResetCodes.email, email),
          eq(passwordResetCodes.code, code),
          eq(passwordResetCodes.used, false),
          gt(passwordResetCodes.expiresAt, new Date()),
        ),
      });

      if (!resetCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired reset code",
        });
      }

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const hashedPassword = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      // Scope the write by primary key, not by email.
      //
      // `users.email` carries no unique constraint, so `where(eq(users.email, …))`
      // would rewrite the password of *every* account sharing this address — and
      // duplicates are reachable, since signup does a check-then-insert with
      // nothing to make it atomic and the OAuth adapter can create a second row
      // for an address that already has a credentials account.
      await ctx.db
        .update(users)
        .set({ password: hashedPassword, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      // Invalidate every outstanding code for this address, not just the one
      // consumed. Each request inserted a new row without expiring the previous
      // ones, so up to 5 codes stayed valid per window — including after the
      // password had already been changed.
      await ctx.db
        .update(passwordResetCodes)
        .set({ used: true })
        .where(
          and(
            eq(passwordResetCodes.email, email),
            eq(passwordResetCodes.used, false),
          ),
        );

      return { success: true };
    }),
});