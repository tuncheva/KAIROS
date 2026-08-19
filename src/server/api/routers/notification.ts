
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { notifications } from "~/server/db/schema";
import { eq, and, desc, count } from "drizzle-orm";
import { emitNotification } from "~/server/socket/emit";

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

  create: protectedProcedure
    .input(
      z.object({
        type: z.enum(["event", "task", "project", "system", "like", "comment", "reply"]),
        title: z.string(),
        message: z.string(),
        link: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [notification] = await ctx.db
        .insert(notifications)
        .values({
          userId: ctx.session.user.id,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link,
          read: false,
        })
        .returning();

      if (notification) {
        emitNotification(ctx.session.user.id, {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          link: notification.link,
        });
      }

      return notification;
    }),
});