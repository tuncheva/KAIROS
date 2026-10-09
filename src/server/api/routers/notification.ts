
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { notifications, pushSubscriptions } from "~/server/db/schema";
import { isPushConfigured, pushConfigProblem, sendPushToUsers } from "~/server/notifications/push";
import { eq, and, desc, count } from "drizzle-orm";

/**
 * A browser's PushSubscription, as `subscription.toJSON()` serialises it. The
 * endpoint is always https on every push service we would talk to; rejecting
 * anything else stops this route being used to make the server POST elsewhere.
 */
const pushSubscriptionInput = z.object({
  endpoint: z.string().url().max(2048).startsWith("https://"),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
  userAgent: z.string().max(512).optional(),
});

/**
 * Cap on `getAll`. The notification bell shows a short list, so there is no
 * reason to ship a user's entire history — and this query is polled on an
 * interval, so an unbounded SELECT grows more expensive for every user forever.
 */
const MAX_NOTIFICATIONS = 50;

export const notificationRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(MAX_NOTIFICATIONS).optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userNotifications = await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, ctx.session.user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(input?.limit ?? MAX_NOTIFICATIONS);

      return userNotifications;
    }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    // COUNT(*) in the database rather than fetching every unread row and taking
    // `.length` — this runs on a poll interval for every signed-in user.
    const [row] = await ctx.db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.session.user.id),
          eq(notifications.read, false)
        )
      );

    return row?.count ?? 0;
  }),

  markAsRead: protectedProcedure
    .input(
      z.object({
        notificationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Parse ID consistently: strip any prefix before a dash, take the numeric part
      const raw = input.notificationId;
      const numericPart = raw.includes("-") ? raw.split("-").pop()! : raw;
      const actualId = parseInt(numericPart, 10);

      if (isNaN(actualId)) {
        return { success: true, message: "Client-side notification marked as read" };
      }

      const notification = await ctx.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.id, actualId),
            eq(notifications.userId, ctx.session.user.id)
          )
        )
        .limit(1);

      if (notification.length === 0) {
        return { success: true, message: "Notification not found or already handled" };
      }


      await ctx.db
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.id, actualId));

      return { success: true, message: "Notification marked as read" };
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.userId, ctx.session.user.id),
          eq(notifications.read, false)
        )
      );

    return { success: true, message: "All notifications marked as read" };
  }),

  delete: protectedProcedure
    .input(
      z.object({
        notificationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const raw = input.notificationId;
      const numericPart = raw.includes("-") ? raw.split("-").pop()! : raw;
      const id = parseInt(numericPart, 10);
      
      if (isNaN(id)) {
        return { success: true, message: "Client-side notification removed" };
      }

      await ctx.db
        .delete(notifications)
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.userId, ctx.session.user.id)
          )
        );

      return { success: true, message: "Notification deleted" };
    }),

  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(notifications)
      .where(eq(notifications.userId, ctx.session.user.id));

    return { success: true, message: "All notifications deleted" };
  }),

  /** Whether this deployment has VAPID keys, i.e. whether push can work at all. */
  pushStatus: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ count: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.session.user.id));
    return { configured: isPushConfigured(), problem: pushConfigProblem(), devices: row?.count ?? 0 };
  }),

  /**
   * Upsert on endpoint. An endpoint names a browser install, so if another
   * account had it (same phone, different sign-in) it moves to this one.
   */
  pushSubscribe: protectedProcedure
    .input(pushSubscriptionInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(pushSubscriptions)
        .values({
          userId: ctx.session.user.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: ctx.session.user.id,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            userAgent: input.userAgent ?? null,
          },
        });
      return { success: true };
    }),

  pushUnsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url().max(2048) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, ctx.session.user.id),
            eq(pushSubscriptions.endpoint, input.endpoint),
          ),
        );
      return { success: true };
    }),

  /** A push to every device of the caller, without adding a row to the bell. */
  pushTest: protectedProcedure
    .input(z.object({ title: z.string().max(120), message: z.string().max(400) }))
    .mutation(async ({ ctx, input }) => {
      return sendPushToUsers(
        ctx.db,
        [{ userId: ctx.session.user.id, title: input.title, message: input.message, link: "/settings?section=notifications" }],
        { badge: false },
      );
    }),
});