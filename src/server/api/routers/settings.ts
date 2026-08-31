

import { z } from "zod";
import { isValidTimeZone } from "~/lib/timezone";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { users, accounts, sessions } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  consumeVerificationCode,
  issueVerificationCode,
} from "~/server/email/verificationCodes";
import { sendEmailVerificationCode } from "~/server/email/email";
import {
  consumeAuthRateLimit,
  createAuthRateLimitKey,
} from "~/server/security/authRateLimit";
import { createLogger } from "~/server/logger";

const log = createLogger("settings.router");

export const settingsRouter = createTRPCRouter({
 
  get: protectedProcedure
    .query(async ({ ctx }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          bio: true,
         
          inAppNotifications: true,
          directMessageNotifications: true,
          projectUpdatesNotifications: true,
          taskAssignmentNotifications: true,
          taskDueRemindersNotifications: true,
          eventRemindersNotifications: true,
          eventUpdatesNotifications: true,
          eventRsvpNotifications: true,
          socialNotifications: true,
          inviteNotifications: true,
          workspaceNotifications: true,
          emailNotifications: true,
          marketingEmailsNotifications: true,
          notificationPosition: true,
        
          language: true,
          timezone: true,
          dateFormat: true,
         
          theme: true,
          accentColor: true,
        
          profileVisibility: true,
          profileAudience: true,
          allowFollowers: true,
          showActivityFeed: true,
          showOnlineStatus: true,
          activityTracking: true,
          dataCollection: true,
        

          notesKeepUnlockedUntilClose: true,
          calendarFeedToken: true,

          // Expose reset PIN hint and lockout metadata (but never the PIN itself)
          resetPinHint: true,
          resetPinFailedAttempts: true,
          resetPinLockedUntil: true,
          // Read only to answer "is one set?" below. Never returned.
          resetPinHash: true,

          createdAt: true,
        },
      });

      if (!user) return null;

      // Whether a PIN exists is a fact the settings screen needs and the hash is
      // one it must never see. Settings inferred it from `resetPinHint` before,
      // which is optional, and from `resetPinFailedAttempts >= 0`, which is true
      // for every account that has never failed — so the screen told everyone
      // they had a PIN configured.
      const { resetPinHash, ...rest } = user;
      return { ...rest, hasResetPin: !!resetPinHash };
    }),


  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255).optional(),
      bio: z.string().max(100).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users)
        .set({
          name: input.name,
          bio: input.bio,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),


  /**
   * Every field optional, and only the provided ones are written.
   *
   * That matters more now that there are thirteen: a client that sends a partial
   * object must not have the omitted switches reset to whatever its own defaults
   * happen to be. The empty-input case is rejected rather than issuing an UPDATE
   * that sets only `updatedAt`.
   */
  /**
   * Mint the subscribable calendar URL, or replace the one that exists.
   *
   * One procedure for both, because they are the same operation from the
   * user's side ("give me a URL" / "give me a different URL") and splitting
   * them would mean the settings screen deciding which to call based on state
   * it already has to render anyway.
   *
   * The token *is* the credential — see the feed route — so it comes from
   * `randomBytes`, not from anything derived from the user, and it is 32 bytes
   * rendered as 64 hex characters.
   */
  rotateCalendarFeedToken: protectedProcedure.mutation(async ({ ctx }) => {
    const token = randomBytes(32).toString("hex");

    await ctx.db
      .update(users)
      .set({ calendarFeedToken: token, updatedAt: new Date() })
      .where(eq(users.id, ctx.session.user.id));

    return { token };
  }),

  /** Turn the feed off. The URL stops resolving immediately. */
  revokeCalendarFeedToken: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(users)
      .set({ calendarFeedToken: null, updatedAt: new Date() })
      .where(eq(users.id, ctx.session.user.id));

    return { success: true };
  }),

  updateNotifications: protectedProcedure
    .input(z.object({
      inAppNotifications: z.boolean().optional(),
      directMessageNotifications: z.boolean().optional(),
      projectUpdatesNotifications: z.boolean().optional(),
      taskAssignmentNotifications: z.boolean().optional(),
      taskDueRemindersNotifications: z.boolean().optional(),
      eventRemindersNotifications: z.boolean().optional(),
      eventUpdatesNotifications: z.boolean().optional(),
      eventRsvpNotifications: z.boolean().optional(),
      socialNotifications: z.boolean().optional(),
      inviteNotifications: z.boolean().optional(),
      workspaceNotifications: z.boolean().optional(),
      emailNotifications: z.boolean().optional(),
      marketingEmailsNotifications: z.boolean().optional(),
      /**
       * Where the notification popups appear. The one *where* control among a
       * panel of *what* switches, folded in here because the mutation already
       * spreads its input into the update.
       *
       * `bottom-right` is accepted so a stored legacy value round-trips, but
       * the picker never offers it — that corner belongs to Ask Kairos. See
       * `~/lib/notificationPosition`.
       */
      notificationPosition: z
        .enum([
          "top-left",
          "top-center",
          "top-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ])
        .optional(),
    }).refine((v) => Object.keys(v).length > 0, {
      message: "No notification preferences supplied",
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),

 
  updateLanguageRegion: protectedProcedure
    .input(z.object({
      // Matches `languageEnum`, which now lists only locales that have a message
      // file. Accepting `ja` here stored a preference nothing could honour.
      language: z.enum(["en", "bg", "es", "fr", "de"]).optional(),
      // Validated rather than merely typed. This preference stopped being
      // cosmetic when the scheduler began reading it: an unrecognised zone makes
      // `Intl.DateTimeFormat` throw, and a zone that is really a fixed offset
      // (`+02:00`) reinstates the seasonal drift the zone was introduced to fix.
      // The picker only offers real zones, but this input is reachable without it.
      timezone: z
        .string()
        .refine(isValidTimeZone, { message: "Unknown IANA time zone" })
        .optional(),
      dateFormat: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),

  /**
   * Email a confirmation code for the signed-in user's own address.
   *
   * Signup sends a link, because at that moment there is no session and the
   * mail client is the only place the person can be reached. This is the other
   * situation: they are signed in, looking at Settings, and can type eight
   * digits into the form that is already on screen.
   *
   * Rate-limited on the account, not the IP: the caller is authenticated, so
   * there is nobody to enumerate and the only abuse left is using somebody's
   * own session to send themselves mail in a loop.
   */
  sendEmailVerificationCode: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.session.user.id),
      columns: { name: true, email: true, emailVerified: true },
    });

    if (!user?.email) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No email on file." });
    }

    if (user.emailVerified) {
      // Not an error the UI should ever provoke — the row hides the control
      // once verified — but a second tab with a stale query could.
      return { success: true, alreadyVerified: true as const };
    }

    await consumeAuthRateLimit(
      createAuthRateLimitKey("verify_code_send", ctx.session.user.id),
    );

    const code = await issueVerificationCode(ctx.db, "email_verify", user.email);

    // Awaited, unlike signup's fire-and-forget: the user is watching a button
    // and a failure here has to reach them rather than a log line.
    try {
      await sendEmailVerificationCode({
        email: user.email,
        userName: user.name ?? user.email,
        code,
      });
    } catch (err) {
      log.error("failed to send verification code", { err });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Couldn't send the code. Try again in a moment.",
      });
    }

    return { success: true, alreadyVerified: false as const };
  }),

  /**
   * Redeem a code and mark the address confirmed.
   *
   * Confirming here has the same effect as clicking the emailed link: it is
   * what lifts the sign-in refusal in `auth/config.ts`, so a user who never
   * found the signup mail can rescue the account from inside a session they
   * still have.
   */
  confirmEmailVerificationCode: protectedProcedure
    .input(z.object({ code: z.string().regex(/^\d{8}$/, "Enter the 8-digit code") }))
    .mutation(async ({ ctx, input }) => {
      await consumeAuthRateLimit(
        createAuthRateLimitKey("verify_code_confirm", ctx.session.user.id),
      );

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: { id: true, email: true, emailVerified: true },
      });

      if (!user?.email) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No email on file." });
      }

      if (user.emailVerified) return { success: true };

      const result = await consumeVerificationCode(
        ctx.db,
        "email_verify",
        user.email,
        input.code,
      );

      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            result.reason === "expired"
              ? "That code has expired. Send yourself a new one."
              : result.reason === "too_many_attempts"
                ? "Too many incorrect attempts. Send yourself a new code."
                : "That code is not valid.",
        });
      }

      await ctx.db
        .update(users)
        .set({ emailVerified: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return { success: true };
    }),

  updateSecurity: protectedProcedure
    .input(
      z.object({
        notesKeepUnlockedUntilClose: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(users)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),

  /**
   * Configure or update the secret reset PIN + hint for the current user.
   */
  updateResetPin: protectedProcedure
    .input(
      z.object({
        pin: z.string().regex(/^\d{4,}$/, "PIN must be at least 4 digits"),
        confirmPin: z.string().regex(/^\d{4,}$/, "PIN must be at least 4 digits"),
        hint: z.string().max(200).optional().nullable(),
      }).refine((data) => data.pin === data.confirmPin, {
        message: "PINs do not match",
        path: ["confirmPin"],
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Sanitize hint by trimming whitespace; empty -> null
      const rawHint = input.hint ?? "";
      const sanitizedHint = rawHint.trim() === "" ? null : rawHint.trim();

      const hash = await argon2.hash(input.pin, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      await ctx.db
        .update(users)
        .set({
          resetPinHash: hash,
          resetPinHint: sanitizedHint,
          // Reset lockout state on successful (re)configuration
          resetPinFailedAttempts: 0,
          resetPinLockedUntil: null,
          resetPinLastFailedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),

  
  updateAppearance: protectedProcedure
    .input(z.object({
      theme: z.enum(["light", "dark", "system"]).optional(),
      accentColor: z.enum(["purple", "pink", "caramel", "mint", "sky", "strawberry"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),


  updatePrivacy: protectedProcedure
    .input(z.object({
      profileVisibility: z.boolean().optional(),
      profileAudience: z.enum(["everyone", "organization", "shared"]).optional(),
      allowFollowers: z.boolean().optional(),
      showActivityFeed: z.boolean().optional(),
      showOnlineStatus: z.boolean().optional(),
      activityTracking: z.boolean().optional(),
      dataCollection: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),


  /**
   * Export moved to `GET /api/export/{format}`.
   *
   * What was here returned `{ success: true, message: "You'll receive an email
   * when it's ready" }` and did nothing else — no job, no email, no file. It had
   * no callers, so nothing is broken by its removal; it is noted rather than
   * silently deleted because "we already have an export endpoint" was true of the
   * codebase and false of the product.
   *
   * A file download is not a tRPC shape: see the route handler for why.
   */

 
  deleteAllData: protectedProcedure
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      // Explicitly delete sessions and accounts first to avoid FK issues
      // even with cascade (e.g. if migration hasn't run yet on old DBs)
      await ctx.db.delete(sessions).where(eq(sessions.userId, userId));
      await ctx.db.delete(accounts).where(eq(accounts.userId, userId));
      await ctx.db.delete(users).where(eq(users.id, userId));

      return { success: true };
    }),
});