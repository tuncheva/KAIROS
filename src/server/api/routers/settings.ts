

import { z } from "zod";
import { isValidTimeZone } from "~/lib/timezone";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { users, accounts, sessions } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import * as argon2 from "argon2";

export const settingsRouter = createTRPCRouter({
 
  get: protectedProcedure
    .query(async ({ ctx }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: {
          id: true,
          name: true,
          email: true,
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
        
          language: true,
          timezone: true,
          dateFormat: true,
         
          theme: true,
          accentColor: true,
        
          profileVisibility: true,
          showOnlineStatus: true,
          activityTracking: true,
          dataCollection: true,
        

          notesKeepUnlockedUntilClose: true,

          // Expose reset PIN hint and lockout metadata (but never the PIN itself)
          resetPinHint: true,
          resetPinFailedAttempts: true,
          resetPinLockedUntil: true,

          createdAt: true,
        },
      });

      return user ?? null;
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