import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { users, passwordResetCodes } from "~/server/db/schema";
import { eq, and, gt } from "drizzle-orm";
import * as argon2 from "argon2";
import { TRPCError } from "@trpc/server";
import { sendWelcomeEmail, sendPasswordResetCode } from "~/server/email";
import crypto from "node:crypto";
import { consumeAuthRateLimit, createAuthRateLimitKey } from "~/server/authRateLimit";

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

      // Rate limit by email to prevent signup spam
      consumeAuthRateLimit(createAuthRateLimitKey("signup", email));

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

      const [newUser] = await ctx.db
        .insert(users)
        .values({
          email,
          password: hashedPassword,
          name: name ?? null,
          emailVerified: new Date(),
        })
        .returning();

      // Send welcome email (fire-and-forget, don't block signup)
      void sendWelcomeEmail({
        email,
        userName: name ?? email,
      }).catch((err) => {
        console.error("Failed to send welcome email to:", email, err);
      });

      return {
        success: true,
        userId: newUser?.id,
      };
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
      consumeAuthRateLimit(createAuthRateLimitKey("reset_request", email));

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
        console.error("Failed to send password reset code:", err);
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
      consumeAuthRateLimit(createAuthRateLimitKey("verify_code", email));

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
      consumeAuthRateLimit(createAuthRateLimitKey("reset_password", email));

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