import { z } from "zod";
import { protectedProcedure, createTRPCRouter } from "~/server/api/trpc";
import { stickyNotes, noteShares, tasks, projects, events, organizationMembers } from "~/server/db/schema";
import { and, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

export const calendarRouter = createTRPCRouter({
  getForRange: protectedProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Tasks & events logic mirrors task.getForCalendar but is collocated here.
      const memberships = await ctx.db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, ctx.session.user.id));
      const orgIds = memberships.map((m) => m.organizationId);

      const taskRows = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
          projectId: tasks.projectId,
          projectTitle: projects.title,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            isNotNull(tasks.dueDate),
            gte(tasks.dueDate, input.from),
            lte(tasks.dueDate, input.to),
            orgIds.length
              ? or(
                  sql`${projects.organizationId} IN ${orgIds}`,
                  and(eq(projects.createdById, ctx.session.user.id), isNull(projects.organizationId)),
                )
              : and(eq(projects.createdById, ctx.session.user.id), isNull(projects.organizationId)),
          ),
        )
        .orderBy(tasks.dueDate);

      const eventRows = await ctx.db
        .select({
          id: events.id,
          title: events.title,
          eventDate: events.eventDate,
          description: events.description,
        })
        .from(events)
        .where(
          and(
            eq(events.createdById, ctx.session.user.id),
            gte(events.eventDate, input.from),
            lte(events.eventDate, input.to),
          ),
        )
        .orderBy(events.eventDate);

      const noteRows = await ctx.db
        .select({
          id: stickyNotes.id,
          title: stickyNotes.title,
          calendarDate: stickyNotes.calendarDate,
          createdAt: stickyNotes.createdAt,
          updatedAt: stickyNotes.updatedAt,
          passwordHash: stickyNotes.passwordHash,
          notebookId: stickyNotes.notebookId,
          createdById: stickyNotes.createdById,
        })
        .from(stickyNotes)
        .leftJoin(noteShares, eq(noteShares.noteId, stickyNotes.id))
        .where(
          and(
            isNotNull(stickyNotes.calendarDate),
            gte(stickyNotes.calendarDate, input.from),
            lte(stickyNotes.calendarDate, input.to),
            or(
              eq(stickyNotes.createdById, ctx.session.user.id),
              eq(noteShares.sharedWithId, ctx.session.user.id),
            ),
          ),
        );

      // Expose only whether a note is locked, never the Argon2 hash itself.
      const notes = noteRows.map(({ passwordHash, ...note }) => ({
        ...note,
        isPasswordProtected: !!passwordHash,
      }));

      return {
        tasks: taskRows,
        events: eventRows,
        notes,
      };
    }),
});
