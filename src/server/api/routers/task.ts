
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertProjectPermission } from "~/server/api/authz";
import { tasks, projects, projectCollaborators, taskActivityLog, organizationMembers, users, organizations, events } from "~/server/db/schema";
import { eq, and, desc, sql, isNull, gte, lte, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as Database } from "~/server/db";
import {
  notifyTaskAssignmentChanged,
  notifyTaskCreated,
  notifyTaskDeleted,
  notifyTaskDetailsChanged,
  notifyTaskStatusChanged,
} from "~/server/notifications/workNotices";

/**
 * Check that `parentTaskId` may hold subtasks in `projectId`.
 *
 * Subtasks go one level deep: the parent must be a top-level task in the same
 * project. `childId` is the task being moved under it, if it already exists —
 * it cannot become its own parent, and a task that has subtasks of its own
 * cannot become one.
 */
async function assertValidParent(
  db: typeof Database,
  projectId: number,
  parentTaskId: number,
  childId?: number,
) {
  if (childId !== undefined && parentTaskId === childId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A task cannot be its own subtask" });
  }

  const [parent] = await db
    .select({ projectId: tasks.projectId, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));

  if (parent?.projectId !== projectId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Parent task not found in this project" });
  }
  if (parent.parentTaskId !== null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Subtasks cannot have subtasks" });
  }

  if (childId !== undefined) {
    const [child] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parentTaskId, childId))
      .limit(1);
    if (child) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A task with subtasks cannot become a subtask",
      });
    }
  }
}

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
        /** Create as a subtask of this top-level task. */
        parentTaskId: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Creating a task in an organization project requires `canAssignTasks`.
      // This replaces ~40 lines of inline checks that were copy-pasted into four
      // mutations in this file and had drifted apart; see `~/server/api/authz`.
      await assertProjectPermission(ctx, input.projectId, "canAssignTasks");

      if (input.parentTaskId !== undefined) {
        await assertValidParent(ctx.db, input.projectId, input.parentTaskId);
      }

      
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
          parentTaskId: input.parentTaskId ?? null,
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

        await notifyTaskCreated(ctx.db, {
          actorId: ctx.session.user.id,
          projectId: input.projectId,
          task,
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

      await notifyTaskStatusChanged(ctx.db, {
        actorId: ctx.session.user.id,
        projectId: task.projectId,
        task,
        oldStatus,
        newStatus: input.status,
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
        /** Move under this top-level task, or `null` to make it top-level. */
        parentTaskId: z.number().int().optional().nullable(),
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

      const parentChanged =
        input.parentTaskId !== undefined && input.parentTaskId !== task.parentTaskId;
      if (parentChanged && input.parentTaskId != null) {
        await assertValidParent(ctx.db, task.projectId, input.parentTaskId, task.id);
      }

      const updateData: {
        updatedAt: Date;
        lastEditedById: string;
        lastEditedAt: Date;
        title?: string;
        description?: string;
        assignedToId?: string | null;
        priority?: "low" | "medium" | "high" | "urgent";
        dueDate?: Date | null;
        parentTaskId?: number | null;
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
      if (parentChanged) updateData.parentTaskId = input.parentTaskId ?? null;

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

      /* Being handed somebody else's task is the one edit the new owner has to
         know about — and losing one is the one the previous owner has to know
         about. Scoped to an actual change of assignee: the task dialog sends the
         current `assignedToId` back on every save, so comparing against the
         stored value is what keeps a title tweak from re-notifying anyone. */
      const taskTitle = input.title ?? task.title;
      const assigneeChanged =
        input.assignedToId !== undefined && input.assignedToId !== task.assignedToId;

      if (assigneeChanged) {
        await notifyTaskAssignmentChanged(ctx.db, {
          actorId: ctx.session.user.id,
          projectId: task.projectId,
          taskTitle,
          previousAssigneeId: task.assignedToId,
          newAssigneeId: input.assignedToId ?? null,
        });
      } else {
        // A schedule or priority change matters to whoever owns the task. Skipped
        // when the task also changed hands: the new owner's assignment notice
        // already describes the task as it now is.
        await notifyTaskDetailsChanged(ctx.db, {
          actorId: ctx.session.user.id,
          projectId: task.projectId,
          taskTitle,
          assigneeId: task.assignedToId,
          dueDate:
            input.dueDate !== undefined ? { from: task.dueDate, to: input.dueDate } : undefined,
          priority:
            input.priority !== undefined ? { from: task.priority, to: input.priority } : undefined,
        });
      }

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

      // `task` was read above, before the delete, so it can still be named.
      await notifyTaskDeleted(ctx.db, {
        actorId: ctx.session.user.id,
        projectId: task.projectId,
        task,
      });

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

      await notifyTaskDeleted(ctx.db, {
        actorId: ctx.session.user.id,
        projectId: task.projectId,
        task,
      });

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
          parentTaskId: tasks.parentTaskId,
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

      /*
       * The same row shape as `getProjectActivity`, deliberately.
       *
       * This used to return bare `taskActivityLog` rows, whose only trace of a
       * person is a `userId` string — nothing a reader could render. Matching
       * the project-scoped query means the client maps both through the one
       * `toTimelineEvent`, so a task's own history cannot describe an event
       * differently from the project timeline that also lists it.
       *
       * Newest first, for the same reason: history is read from the top.
       */
      const activities = await ctx.db
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
        .where(eq(taskActivityLog.taskId, input.taskId))
        .orderBy(desc(taskActivityLog.createdAt));

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
          assignedToId: tasks.assignedToId,
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
