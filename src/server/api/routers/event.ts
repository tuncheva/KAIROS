import { z } from "zod";
import { protectedProcedure, publicProcedure, createTRPCRouter } from "../trpc";
import { events, eventComments, eventLikes, eventRsvps, users, notifications } from "~/server/db/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { type NewEvent } from "~/server/db/schema";
import { TRPCError } from "@trpc/server";
import { emitNotification, emitEventDeleted, emitEventUpdated } from "~/server/ws/emit";
import { createLogger } from "~/server/logger";

const log = createLogger("event");

const createEventSchema = z.object({
  title: z.string().min(1, "Title is required").max(256),
  description: z.string().min(1, "Description is required").max(5000),
  eventDate: z.date(),
  region: z.enum([
    "sofia", "plovdiv", "varna", "burgas", "ruse", 
    "stara_zagora", "pleven", "sliven", "dobrich", "shumen"
  ]), 
  imageUrl: z.string().url().optional(),
  enableRsvp: z.boolean().default(false),
  sendReminders: z.boolean().default(false),
});

const addCommentSchema = z.object({
  eventId: z.number(),
  text: z.string().max(500),
  imageUrl: z.string().url().optional(),
}).refine(
  (data) => data.text.trim().length > 0 || data.imageUrl !== undefined,
  { message: "Comment must have either text or an image" }
);

const toggleLikeSchema = z.object({
  eventId: z.number(),
});

const updateRsvpSchema = z.object({
  eventId: z.number(),
  status: z.enum(["going", "maybe", "not_going"]),
  reminderMinutesBefore: z.number().int().min(0).nullable().optional(),
});

const deleteEventSchema = z.object({
  eventId: z.number(),
});

const updateEventSchema = z.object({
  eventId: z.number(),
  title: z.string().min(1, "Title is required").max(256).optional(),
  description: z.string().min(1, "Description is required").max(5000).optional(),
  eventDate: z.date().optional(),
  region: z.enum([
    "sofia", "plovdiv", "varna", "burgas", "ruse",
    "stara_zagora", "pleven", "sliven", "dobrich", "shumen"
  ]).optional(),
  imageUrl: z.string().url().optional().nullable(),
  enableRsvp: z.boolean().optional(),
  sendReminders: z.boolean().optional(),
});

const sendRemindersSchema = z.void();

export const eventRouter = createTRPCRouter({
  createEvent: protectedProcedure
    .input(createEventSchema)
    .mutation(async ({ ctx, input }) => {
      const { title, description, eventDate, region, imageUrl, enableRsvp, sendReminders } = input;
      const createdById = ctx.session.user.id;

      if (!region) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Region is required",
        });
      }

      const newEvent: NewEvent = {
        title,
        description,
        eventDate,
        region, 
        imageUrl: imageUrl ?? null,
        createdById,
        enableRsvp,
        sendReminders,
      };

      await ctx.db.insert(events).values(newEvent);
      return { success: true };
    }),

  getPublicEvents: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
          cursor: z
            .object({
              createdAt: z.date(),
              id: z.number().int(),
            })
            .optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const currentUserId = ctx.session?.user?.id ?? null;
      const limit = input?.limit ?? 10;

      // Cursor-based pagination with stable ordering: (createdAt desc, id desc)
      const cursorFilter = input?.cursor
        ? sql`(
            ${events.createdAt} < ${input.cursor.createdAt}
            OR (${events.createdAt} = ${input.cursor.createdAt} AND ${events.id} < ${input.cursor.id})
          )`
        : undefined;

      const rows = await ctx.db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          eventDate: events.eventDate,
          region: events.region,
          imageUrl: events.imageUrl,
          createdAt: events.createdAt,
          createdById: events.createdById,
          enableRsvp: events.enableRsvp,

          authorId: users.id,
          authorName: users.name,
          authorImage: users.image,

          commentCount:
            sql<number>`(SELECT count(*) FROM ${eventComments} WHERE ${eventComments.eventId} = ${events.id})`.mapWith(
              Number
            ),
          likeCount: sql<number>`(SELECT count(*) FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id})`.mapWith(
            Number
          ),

          hasLiked: currentUserId
            ? sql<boolean>`EXISTS(SELECT 1 FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id} AND ${eventLikes.createdById} = ${currentUserId})`
            : sql<boolean>`false`,
          userRsvpStatus: currentUserId
            ? sql<string>`(SELECT status FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.userId} = ${currentUserId})`
            : sql<null>`null`,

          rsvpGoing:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'going')`.mapWith(
              Number
            ),
          rsvpMaybe:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'maybe')`.mapWith(
              Number
            ),
          rsvpNotGoing:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'not_going')`.mapWith(
              Number
            ),
        })
        .from(events)
        .leftJoin(users, eq(events.createdById, users.id))
        .where(cursorFilter ? and(cursorFilter) : undefined)
        .orderBy(desc(events.createdAt), desc(events.id))
        .limit(limit + 1);

      const pageRows = rows.slice(0, limit);
      const nextCursor = rows.length > limit
        ? { createdAt: pageRows[pageRows.length - 1]!.createdAt, id: pageRows[pageRows.length - 1]!.id }
        : null;

      const eventIds = pageRows.map((r) => r.id);
      const allComments =
        eventIds.length > 0
          ? await ctx.db
              .select({
                id: eventComments.id,
                eventId: eventComments.eventId,
                text: eventComments.text,
                imageUrl: eventComments.imageUrl,
                createdAt: eventComments.createdAt,
                authorId: users.id,
                authorName: users.name,
                authorImage: users.image,
              })
              .from(eventComments)
              .leftJoin(users, eq(eventComments.createdById, users.id))
              .where(inArray(eventComments.eventId, eventIds))
              .orderBy(desc(eventComments.createdAt))
          : [];

      interface CommentWithAuthor {
        id: number;
        text: string;
        imageUrl: string | null;
        createdAt: Date;
        author: {
          id: string | null;
          name: string | null;
          image: string | null;
        };
      }

      const commentsByEvent = allComments.reduce((acc, comment) => {
        acc[comment.eventId] = acc[comment.eventId] ?? [];
        acc[comment.eventId]!.push({
          id: comment.id,
          text: comment.text,
          imageUrl: comment.imageUrl,
          createdAt: comment.createdAt,
          author: {
            id: comment.authorId,
            name: comment.authorName,
            image: comment.authorImage,
          },
        });
        return acc;
      }, {} as Record<number, CommentWithAuthor[]>);

      const items = pageRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        eventDate: row.eventDate,
        region: row.region,
        imageUrl: row.imageUrl,
        createdAt: row.createdAt,
        createdById: row.createdById,
        enableRsvp: row.enableRsvp,
        commentCount: row.commentCount,
        likeCount: row.likeCount,
        hasLiked: row.hasLiked,
        userRsvpStatus: row.userRsvpStatus as "going" | "maybe" | "not_going" | null,
        author: {
          id: row.authorId,
          name: row.authorName,
          image: row.authorImage,
        },
        comments: commentsByEvent[row.id] ?? [],
        rsvpCounts: {
          going: row.rsvpGoing,
          maybe: row.rsvpMaybe,
          notGoing: row.rsvpNotGoing,
        },
      }));

      return { items, nextCursor };
    }),

  addComment: protectedProcedure
    .input(addCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;

      await ctx.db.insert(eventComments).values({
        eventId: input.eventId,
        text: input.text,
        imageUrl: input.imageUrl,
        createdById: currentUserId,
      });

      // Notify event owner about the comment (unless they're the commenter)
      const [eventRow] = await ctx.db
        .select({ createdById: events.createdById, title: events.title })
        .from(events)
        .where(eq(events.id, input.eventId))
        .limit(1);

      if (eventRow && eventRow.createdById !== currentUserId) {
        const commenter = await ctx.db.query.users.findFirst({
          where: eq(users.id, currentUserId),
          columns: { name: true },
        });
        const commenterName = commenter?.name ?? "Someone";

        await ctx.db.insert(notifications).values({
          userId: eventRow.createdById,
          type: "comment",
          title: "New comment on your event",
          message: `${commenterName} commented on "${eventRow.title}"`,
          link: `/publish#event-${input.eventId}`,
          read: false,
        });
        emitNotification(eventRow.createdById, {
          id: `comment-${input.eventId}-${Date.now()}`,
          type: "comment",
          title: "New comment on your event",
          message: `${commenterName} commented on "${eventRow.title}"`,
          link: `/publish#event-${input.eventId}`,
        });
      }

      // Real-time update for all clients viewing the event feed
      emitEventUpdated(input.eventId);

      return { success: true };
    }),

  toggleLike: protectedProcedure
    .input(toggleLikeSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;

      // Direct check without transaction for speed
      const existingLike = await ctx.db
        .select()
        .from(eventLikes)
        .where(
          and(
            eq(eventLikes.eventId, input.eventId),
            eq(eventLikes.createdById, currentUserId)
          )
        )
        .limit(1);

      if (existingLike.length > 0) {
        await ctx.db
          .delete(eventLikes)
          .where(
            and(
              eq(eventLikes.eventId, input.eventId),
              eq(eventLikes.createdById, currentUserId)
            )
          );
        emitEventUpdated(input.eventId);
        return { action: 'unliked', hasLiked: false };
      } else {
        await ctx.db.insert(eventLikes).values({
          eventId: input.eventId,
          createdById: currentUserId,
        });

        // Notify event owner about the like (unless they liked their own post)
        const [eventRow] = await ctx.db
          .select({ createdById: events.createdById, title: events.title })
          .from(events)
          .where(eq(events.id, input.eventId))
          .limit(1);

        if (eventRow && eventRow.createdById !== currentUserId) {
          const liker = await ctx.db.query.users.findFirst({
            where: eq(users.id, currentUserId),
            columns: { name: true },
          });
          const likerName = liker?.name ?? "Someone";

          await ctx.db.insert(notifications).values({
            userId: eventRow.createdById,
            type: "like",
            title: "New like on your event",
            message: `${likerName} liked your event "${eventRow.title}"`,
            link: `/publish#event-${input.eventId}`,
            read: false,
          });
          emitNotification(eventRow.createdById, {
            id: `like-${input.eventId}-${Date.now()}`,
            type: "like",
            title: "New like on your event",
            message: `${likerName} liked your event "${eventRow.title}"`,
            link: `/publish#event-${input.eventId}`,
          });
        }

        emitEventUpdated(input.eventId);
        return { action: 'liked', hasLiked: true };
      }
    }),

  updateRsvp: protectedProcedure
    .input(updateRsvpSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;

      // Direct check without findFirst for speed
      const existingRsvp = await ctx.db
        .select()
        .from(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, input.eventId),
            eq(eventRsvps.userId, currentUserId)
          )
        )
        .limit(1);

      if (existingRsvp.length > 0) {
        await ctx.db
          .update(eventRsvps)
          .set({ 
            status: input.status,
            updatedAt: new Date(),
            ...(input.reminderMinutesBefore !== undefined
              ? {
                  reminderMinutesBefore: input.reminderMinutesBefore,
                  reminderSent: false,
                }
              : {}),
          })
          .where(
            and(
              eq(eventRsvps.eventId, input.eventId),
              eq(eventRsvps.userId, currentUserId)
            )
          );
      } else {
        await ctx.db.insert(eventRsvps).values({
          eventId: input.eventId,
          userId: currentUserId,
          status: input.status,
          reminderMinutesBefore: input.reminderMinutesBefore ?? null,
          reminderSent: false,
          updatedAt: new Date(),
        });
      }

      emitEventUpdated(input.eventId);
      return { success: true, status: input.status };
    }),

  deleteEvent: protectedProcedure
    .input(deleteEventSchema)
    .mutation(async ({ ctx, input }) => {
      const [event] = await ctx.db
        .select({ id: events.id, createdById: events.createdById })
        .from(events)
        .where(eq(events.id, input.eventId))
        .limit(1);

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      if (event.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this event." });
      }

      await ctx.db.delete(events).where(eq(events.id, input.eventId));

      // Notify all connected clients about the deletion in real-time
      emitEventDeleted(input.eventId);

      return { success: true };
    }),

  updateEvent: protectedProcedure
    .input(updateEventSchema)
    .mutation(async ({ ctx, input }) => {
      const { eventId, ...updates } = input;

      const [event] = await ctx.db
        .select({ id: events.id, createdById: events.createdById })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      if (event.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this event." });
      }

      // Build update object with only defined fields
      const updateFields: Record<string, unknown> = {};
      if (updates.title !== undefined) updateFields.title = updates.title;
      if (updates.description !== undefined) updateFields.description = updates.description;
      if (updates.eventDate !== undefined) updateFields.eventDate = updates.eventDate;
      if (updates.region !== undefined) updateFields.region = updates.region;
      if (updates.imageUrl !== undefined) updateFields.imageUrl = updates.imageUrl;
      if (updates.enableRsvp !== undefined) updateFields.enableRsvp = updates.enableRsvp;
      if (updates.sendReminders !== undefined) updateFields.sendReminders = updates.sendReminders;

      if (Object.keys(updateFields).length === 0) {
        return { success: true };
      }

      await ctx.db
        .update(events)
        .set(updateFields)
        .where(eq(events.id, eventId));

      emitEventUpdated(eventId);

      return { success: true };
    }),
    
  sendEventReminders: protectedProcedure
    .input(sendRemindersSchema)
    .mutation(async ({ ctx: _ctx }) => {
      if (process.env.NODE_ENV !== "production") {
        log.debug("running reminder check");
      }
      return { success: true, message: "Reminder check initiated." };
    }),
});