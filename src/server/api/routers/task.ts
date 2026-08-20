
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertProjectPermission } from "~/server/api/authz";
import { tasks, projects, projectCollaborators, taskActivityLog, organizationMembers, users, organizations, events } from "~/server/db/schema";
import { eq, and, desc, sql, isNull, gte, lte, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export const taskRouter = createTRPCRouter({
 
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        title: z.string().min(1).max(256),
        description: z.string().optional(),
        assignedToId: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]),
        status: z.enum(["pending", "in_progress", "completed", "blocked"]).default("pending"),
        dueDate: z.date().optional(),
        clientRequestId: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Creating a task in an organization project requires `canAssignTasks`.
      // This replaces ~40 lines of inline checks that were copy-pasted into four
      // mutations in this file and had drifted apart; see `~/server/api/authz`.
      await assertProjectPermission(ctx, input.projectId, "canAssignTasks");

      
      // PERF + correctness: avoid loading all tasks and avoid race conditions on orderIndex.
      // Compute next order index with a MAX() query.
      const [maxRow] = await ctx.db
        .select({ max: sql<number>`COALESCE(MAX(${tasks.orderIndex}), 0)`.mapWith(Number) })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));

      const nextOrderIndex = (maxRow?.max ?? 0) + 1;

      // Deduplication: if clientRequestId is provided, check for existing task
      if (input.clientRequestId) {
        const [existing] = await ctx.db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, input.projectId),
              eq(tasks.clientRequestId, input.clientRequestId)
            )
          );
        if (existing) {
          return existing;
        }
      }

      const [task] = await ctx.db
        .insert(tasks)
        .values({
          projectId: input.projectId,
          title: input.title,
          description: input.description ?? "",
          assignedToId: input.assignedToId,
          priority: input.priority,
          dueDate: input.dueDate,
          status: input.status,
          createdById: ctx.session.user.id,
          orderIndex: nextOrderIndex,
          clientRequestId: input.clientRequestId,
        })
        .returning();

      
      if (task) {
        await ctx.db.insert(taskActivityLog).values({
          taskId: task.id,
          userId: ctx.session.user.id,
          action: "created",
          newValue: "Task created",
        });
      }

      return task;
    }),

 
  updateStatus: protectedProcedure
    .input(
      z.object({
        taskId: z.number(),
        status: z.enum(["pending", "in_progress", "completed", "blocked"]),
        /** Optional short summary/note when completing. */
        completionNote: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId));

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      // Moving a task through its statuses is editing the project's work.
      //
      // Being the assignee no longer grants this on its own: a view-only member
      // who happens to be assigned a task must not be able to change it, which
      // is the whole point of the role. Every writing role has
      // `canEditProjects`, so assignees who are contributors are unaffected.
      await assertProjectPermission(ctx, task.projectId, "canEditProjects");

      const oldStatus = task.status;
      
      const updateData: {
        status: "pending" | "in_progress" | "completed" | "blocked";
        updatedAt: Date;
        completedAt?: Date | null;
        completedById?: string | null;
        completionNote?: string | null;
        lastEditedById: string;
        lastEditedAt: Date;
      } = {
        status: input.status,
        updatedAt: new Date(),
        lastEditedById: ctx.session.user.id,
        lastEditedAt: new Date(),
      };

      
      if (input.status === "completed" && oldStatus !== "completed") {
        updateData.completedAt = new Date();
        updateData.completedById = ctx.session.user.id;
        if (input.completionNote !== undefined) {
          updateData.completionNote = input.completionNote;
        }
      }
      
      else if (input.status !== "completed" && oldStatus === "completed") {
        updateData.completedAt = null;
        updateData.completedById = null;
        // Clearing completion resets the note unless caller explicitly wants to keep it.
        updateData.completionNote = null;
      }

      await ctx.db
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, input.taskId));

      
      await ctx.db.insert(taskActivityLog).values({
        taskId: input.taskId,
        userId: ctx.session.user.id,
        action: "status_changed",
        oldValue: oldStatus,
        newValue: input.status,
      });

      return { success: true };
    }),

  
  update: protectedProcedure
    .input(
      z.object({
        taskId: z.number(),
        title: z.string().min(1).max(256).optional(),
        description: z.string().optional(),
        assignedToId: z.string().optional().nullable(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        dueDate: z.date().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId));

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      await assertProjectPermission(ctx, task.projectId, "canEditProjects");

      const updateData: {
        updatedAt: Date;
        lastEditedById: string;
        lastEditedAt: Date;
        title?: string;
        description?: string;
        assignedToId?: string | null;
        priority?: "low" | "medium" | "high" | "urgent";
        dueDate?: Date | null;
      } = {
        updatedAt: new Date(),
        lastEditedById: ctx.session.user.id,
        lastEditedAt: new Date(),
      };

      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.assignedToId !== undefined) updateData.assignedToId = input.assignedToId;
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.dueDate !== undefined) updateData.dueDate = input.dueDate;

      await ctx.db
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, input.taskId));

     
      await ctx.db.insert(taskActivityLog).values({
        taskId: input.taskId,
        userId: ctx.session.user.id,
        action: "updated",
        newValue: "Task updated",
      });

      return { success: true };
    }),

  
  delete: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId));

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      // `canDeleteTasks` has existed as a column since organizations shipped and
      // was set on membership creation, but nothing ever read it — any org member
      // could delete any task. This is the check that makes it real.
      //
      // The flag is deliberately not implied by having created the task: it is
      // false in the contributor template, so deleting is a capability an admin
      // grants rather than something every member has.
      await assertProjectPermission(ctx, task.projectId, "canDeleteTasks");

      await ctx.db.delete(tasks).where(eq(tasks.id, input.taskId));

      return { success: true };
    }),

  /**
   * Hard-remove a task even after it exists on the timeline.
   * Intended for admins/org owners / project owners.
   */
  adminDiscard: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId));
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });

      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId));

      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const isProjectOwner = project.createdById === ctx.session.user.id;

      // Org admins/owner can discard tasks.
      let isOrgOwnerOrAdmin = false;
      if (project.organizationId) {
        const [org] = await ctx.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, project.organizationId));

        const [membership] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, project.organizationId),
              eq(organizationMembers.userId, ctx.session.user.id),
            ),
          );

        const isOrgOwner = org?.createdById === ctx.session.user.id;
        const isOrgAdmin = membership?.role === "admin";
        isOrgOwnerOrAdmin = !!isOrgOwner || !!isOrgAdmin;
      }

      if (!isProjectOwner && !isOrgOwnerOrAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner or an org admin can discard tasks" });
      }

      await ctx.db.delete(tasks).where(eq(tasks.id, input.taskId));
      return { success: true };
    }),

  /**
   * Set/update the completion note.
   * Allowed for: the completer, project owner, org owner/admin.
   */
  setCompletionNote: protectedProcedure
    .input(z.object({ taskId: z.number(), completionNote: z.string().max(2000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId));
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });

      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId));

      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const isProjectOwner = project.createdById === ctx.session.user.id;
      const isCompleter = task.completedById === ctx.session.user.id;

      let isOrgOwnerOrAdmin = false;
      if (project.organizationId) {
        const [org] = await ctx.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, project.organizationId));

        const [membership] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, project.organizationId),
              eq(organizationMembers.userId, ctx.session.user.id),
            ),
          );

        const isOrgOwner = org?.createdById === ctx.session.user.id;
        const isOrgAdmin = membership?.role === "admin";
        isOrgOwnerOrAdmin = !!isOrgOwner || !!isOrgAdmin;
      }

      if (!isCompleter && !isProjectOwner && !isOrgOwnerOrAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not allowed to edit this completion note" });
      }

      await ctx.db
        .update(tasks)
        .set({
          completionNote: input.completionNote,
          updatedAt: new Date(),
          lastEditedById: ctx.session.user.id,
          lastEditedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId));

      await ctx.db.insert(taskActivityLog).values({
        taskId: input.taskId,
        userId: ctx.session.user.id,
        action: "completion_note_set",
        newValue: input.completionNote ?? "",
      });

      return { success: true };
    }),

  getByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId));

      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const isOwner = project.createdById === ctx.session.user.id;

      let hasOrgAccess = false;
      if (project.organizationId) {
        const [membership] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, project.organizationId),
              eq(organizationMembers.userId, ctx.session.user.id)
            )
          )
          .limit(1);
        hasOrgAccess = !!membership;
      }

      if (!isOwner && !hasOrgAccess) {
        const [collaboration] = await ctx.db
          .select()
          .from(projectCollaborators)
          .where(
            and(
              eq(projectCollaborators.projectId, input.projectId),
              eq(projectCollaborators.collaboratorId, ctx.session.user.id)
            )
          )
          .limit(1);
        if (!collaboration) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this project" });
      }

      const creatorUsers = alias(users, "creator_users");
      const assigneeUsers = alias(users, "assignee_users");

      const rows = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
          orderIndex: tasks.orderIndex,
          createdAt: tasks.createdAt,
          creator: {
            id: creatorUsers.id,
            name: creatorUsers.name,
            image: creatorUsers.image,
          },
          assignee: {
            id: assigneeUsers.id,
            name: assigneeUsers.name,
            image: assigneeUsers.image,
          },
        })
        .from(tasks)
        .leftJoin(creatorUsers, eq(tasks.createdById, creatorUsers.id))
        .leftJoin(assigneeUsers, eq(tasks.assignedToId, assigneeUsers.id))
        .where(eq(tasks.projectId, input.projectId))
        .orderBy(tasks.orderIndex);

      return rows;
    }),

  getActivityLog: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ ctx, input }) => {
      // First, verify the user has access to this task's project
      const [task] = await ctx.db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      // Check project access (owner, org member, or collaborator)
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .limit(1);

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const isOwner = project.createdById === ctx.session.user.id;

      let hasOrgAccess = false;
      if (project.organizationId) {
        const [membership] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, project.organizationId),
              eq(organizationMembers.userId, ctx.session.user.id)
            )
          )
          .limit(1);
        hasOrgAccess = !!membership;
      }

      const [collab] = await ctx.db
        .select()
        .from(projectCollaborators)
        .where(
          and(
            eq(projectCollaborators.projectId, task.projectId),
            eq(projectCollaborators.collaboratorId, ctx.session.user.id)
          )
        )
        .limit(1);
      const isCollaborator = !!collab;

      if (!isOwner && !hasOrgAccess && !isCollaborator) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this task" });
      }

      const activities = await ctx.db
        .select()
        .from(taskActivityLog)
        .where(eq(taskActivityLog.taskId, input.taskId))
        .orderBy(taskActivityLog.createdAt);

      return activities;
    }),

  getProjectActivity: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        limit: z.number().min(1).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const isOwner = project.createdById === ctx.session.user.id;

      let hasOrgAccess = false;
      if (project.organizationId) {
        const [membership] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, project.organizationId),
              eq(organizationMembers.userId, ctx.session.user.id)
            )
          )
          .limit(1);
        hasOrgAccess = !!membership;
      }

      const [collaboration] = await ctx.db
        .select()
        .from(projectCollaborators)
        .where(
          and(
            eq(projectCollaborators.projectId, input.projectId),
            eq(projectCollaborators.collaboratorId, ctx.session.user.id)
          )
        )
        .limit(1);

      if (!isOwner && !hasOrgAccess && !collaboration) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to view this project" });
      }

      const limit = input.limit ?? 25;

      const rows = await ctx.db
        .select({
          id: taskActivityLog.id,
          taskId: taskActivityLog.taskId,
          action: taskActivityLog.action,
          oldValue: taskActivityLog.oldValue,
          newValue: taskActivityLog.newValue,
          createdAt: taskActivityLog.createdAt,
          taskTitle: tasks.title,
          user: {
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
          },
        })
        .from(taskActivityLog)
        .innerJoin(tasks, eq(taskActivityLog.taskId, tasks.id))
        .leftJoin(users, eq(taskActivityLog.userId, users.id))
        .where(eq(tasks.projectId, input.projectId))
        .orderBy(desc(taskActivityLog.createdAt))
        .limit(limit);

      return rows;
    }),

  getOrgActivity: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).optional(),
        scope: z.enum(["personal", "organization", "all"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 50;
      const scope = input.scope ?? "organization";

      // Get active organization
      let activeOrganizationId: number | null = null;
      try {
        const [userRow] = await ctx.db
          .select({ activeOrganizationId: users.activeOrganizationId })
          .from(users)
          .where(eq(users.id, ctx.session.user.id))
          .limit(1);
        activeOrganizationId = userRow?.activeOrganizationId ?? null;
      } catch {
        activeOrganizationId = null;
      }

      // Get all organizations the user is a member of
      const memberships = await ctx.db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, ctx.session.user.id));

      const orgIds = memberships.map((m) => m.organizationId);

      let whereCondition;
      let returnScope: "personal" | "organization" | "all";

      if (scope === "all") {
        // All orgs the user is in + personal projects.
        // If user has no org memberships, we still want personal projects.
        whereCondition = orgIds.length
          ? sql`(
              ${projects.organizationId} IN ${orgIds}
              OR (
                ${projects.createdById} = ${ctx.session.user.id}
                AND ${projects.organizationId} IS NULL
              )
            )`
          : sql`(${projects.createdById} = ${ctx.session.user.id} AND ${projects.organizationId} IS NULL)`;
        returnScope = "all";
      } else if (scope === "organization") {
        // Active org only. If there is no active org (or user not member), return nothing
        // rather than leaking personal activity into org scope.
        if (!activeOrganizationId || !orgIds.includes(activeOrganizationId)) {
          return { scope: "organization", rows: [] };
        }
        whereCondition = eq(projects.organizationId, activeOrganizationId);
        returnScope = "organization";
      } else {
        // Personal activity only: tasks from personal projects.
        // This matches the projects list (which uses `organizationId IS NULL`).
        whereCondition = and(
          eq(projects.createdById, ctx.session.user.id),
          isNull(projects.organizationId)
        );
        returnScope = "personal";
      }

      const assigneeUsers = alias(users, "assignee_users");
      const rows = await ctx.db
        .select({
          id: taskActivityLog.id,
          taskId: taskActivityLog.taskId,
          action: taskActivityLog.action,
          oldValue: taskActivityLog.oldValue,
          newValue: taskActivityLog.newValue,
          createdAt: taskActivityLog.createdAt,
          taskTitle: tasks.title,
          projectId: tasks.projectId,
          projectTitle: projects.title,
          user: {
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
          },
          assignee: {
            id: assigneeUsers.id,
            name: assigneeUsers.name,
            image: assigneeUsers.image,
          },
        })
        .from(taskActivityLog)
        .innerJoin(tasks, eq(taskActivityLog.taskId, tasks.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(users, eq(taskActivityLog.userId, users.id))
        .leftJoin(assigneeUsers, eq(tasks.assignedToId, assigneeUsers.id))
        .where(whereCondition)
        .orderBy(desc(taskActivityLog.createdAt))
        .limit(limit);

      return { scope: returnScope, rows };
    }),

  /**
   * Calendar endpoint — returns tasks with due dates and events within a date range.
   */
  getForCalendar: protectedProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get organisations the user belongs to
      const memberships = await ctx.db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, ctx.session.user.id));
      const orgIds = memberships.map((m) => m.organizationId);

      // Tasks with a due date in the range that the user can see
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
                  and(
                    eq(projects.createdById, ctx.session.user.id),
                    isNull(projects.organizationId)
                  )
                )
              : and(
                  eq(projects.createdById, ctx.session.user.id),
                  isNull(projects.organizationId)
                )
          )
        )
        .orderBy(tasks.dueDate);

      // Events created by the user within the range
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
            lte(events.eventDate, input.to)
          )
        )
        .orderBy(events.eventDate);

      return { tasks: taskRows, events: eventRows };
    }),
});