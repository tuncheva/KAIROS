 import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertOrgPermission, assertProjectPermission } from "~/server/api/authz";
import { projects, tasks, projectCollaborators, users, organizationMembers, notifications } from "~/server/db/schema";
import { eq, and, desc, inArray, isNull, sql, ne, or } from "drizzle-orm";
import { emitNotification } from "~/server/socket/emit";

export const projectRouter = createTRPCRouter({
  
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(256),
        description: z.string().optional(),
        shareStatus: z.enum(["private", "shared_read", "shared_write"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let activeOrganizationId: number | null = null;

      try {
        const [user] = await ctx.db
          .select({ activeOrganizationId: users.activeOrganizationId })
          .from(users)
          .where(eq(users.id, ctx.session.user.id))
          .limit(1);

        activeOrganizationId = user?.activeOrganizationId ?? null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("active_organization_id")) {
          throw err;
        }
        activeOrganizationId = null;
      }

      const [membership] = activeOrganizationId
        ? await ctx.db
            .select()
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.userId, ctx.session.user.id),
                eq(organizationMembers.organizationId, activeOrganizationId),
              ),
            )
            .limit(1)
        : [undefined];

      if (process.env.NODE_ENV !== "production") {
        console.log("Creating project - User ID:", ctx.session.user.id);
        console.log("User's organization membership:", membership);
      }

      // A project created inside an organization requires `canCreateProjects`.
      // Outside one the user is creating in their personal space, which needs no
      // organization permission.
      if (membership) {
        await assertOrgPermission(
          ctx,
          membership.organizationId,
          "canCreateProjects",
        );
      }

      const [project] = await ctx.db
        .insert(projects)
        .values({
          title: input.title,
          description: input.description ?? "",
          createdById: ctx.session.user.id,
          shareStatus: input.shareStatus,
          organizationId: membership?.organizationId ?? null,
        })
        .returning();

      if (process.env.NODE_ENV !== "production") {
        console.log("Created project:", {
          id: project?.id,
          title: project?.title,
          organizationId: project?.organizationId,
        });
      }

      return project;
    }),

 
  getMyProjects: protectedProcedure.query(async ({ ctx }) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("Fetching projects for user:", ctx.session.user.id);
    }

    let activeOrganizationId: number | null = null;

    try {
      const [user] = await ctx.db
        .select({ activeOrganizationId: users.activeOrganizationId })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      activeOrganizationId = user?.activeOrganizationId ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("active_organization_id")) {
        throw err;
      }
      activeOrganizationId = null;
    }

    const [membership] = activeOrganizationId
      ? await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.userId, ctx.session.user.id),
              eq(organizationMembers.organizationId, activeOrganizationId),
            ),
          )
          .limit(1)
      : [undefined];

    if (process.env.NODE_ENV !== "production") {
      console.log("User active organization membership:", membership);
    }

    let projectsList;

    if (membership) {
      
      projectsList = await ctx.db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, membership.organizationId), ne(projects.status, "archived")))
        .orderBy(desc(projects.createdAt));

      if (process.env.NODE_ENV !== "production") {
        console.log("Found organization projects:", projectsList.length);
      }
    } else {

      // Personal mode: owned projects + projects where user is a collaborator
      const collabProjectIds = await ctx.db
        .select({ projectId: projectCollaborators.projectId })
        .from(projectCollaborators)
        .where(eq(projectCollaborators.collaboratorId, ctx.session.user.id));

      const collabIds = collabProjectIds.map((c) => c.projectId);

      projectsList = await ctx.db
        .select()
        .from(projects)
        .where(
          and(
            or(
              and(
                eq(projects.createdById, ctx.session.user.id),
                isNull(projects.organizationId),
              ),
              ...(collabIds.length ? [inArray(projects.id, collabIds)] : []),
            ),
            ne(projects.status, "archived")
          )
        )
        .orderBy(desc(projects.createdAt));

      if (process.env.NODE_ENV !== "production") {
        console.log("Found personal projects:", projectsList.length);
      }
    }

    
    const createdByIds = Array.from(new Set(projectsList.map((p) => p.createdById)));
    const createdByUsers = createdByIds.length
      ? await ctx.db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
          })
          .from(users)
          .where(inArray(users.id, createdByIds))
      : [];
    const createdByUserMap = new Map(createdByUsers.map((u) => [u.id, u] as const));

    // Batch-fetch all tasks for visible projects (avoid N+1 queries)
    const projectIds = projectsList.map((p) => p.id);
    const allTasks = projectIds.length
      ? await ctx.db
          .select({
            id: tasks.id,
            status: tasks.status,
            dueDate: tasks.dueDate,
            projectId: tasks.projectId,
          })
          .from(tasks)
          .where(inArray(tasks.projectId, projectIds))
      : [];

    const tasksByProjectId = allTasks.reduce((acc, t) => {
      (acc[t.projectId] ??= []).push({ id: t.id, status: t.status, dueDate: t.dueDate });
      return acc;
    }, {} as Record<number, { id: number; status: string; dueDate: Date | null }[]>);

    // Batch-fetch all collaborators for visible projects
    const allCollaborators = projectIds.length
      ? await ctx.db
          .select({
            projectId: projectCollaborators.projectId,
            collaboratorId: projectCollaborators.collaboratorId,
            permission: projectCollaborators.permission,
            name: users.name,
            image: users.image,
          })
          .from(projectCollaborators)
          .innerJoin(users, eq(projectCollaborators.collaboratorId, users.id))
          .where(inArray(projectCollaborators.projectId, projectIds))
      : [];

    const collaboratorsByProjectId = allCollaborators.reduce((acc, c) => {
      (acc[c.projectId] ??= []).push({
        id: c.collaboratorId,
        name: c.name,
        image: c.image,
        permission: c.permission,
      });
      return acc;
    }, {} as Record<number, { id: string; name: string | null; image: string | null; permission: string }[]>);

    const projectsWithTasks = projectsList.map((project) => ({
      ...project,
      createdByUser: createdByUserMap.get(project.createdById) ?? null,
      tasks: tasksByProjectId[project.id] ?? [],
      collaborators: collaboratorsByProjectId[project.id] ?? [],
    }));


    if (process.env.NODE_ENV !== "production") {
      console.log("Projects with tasks:", projectsWithTasks.map(p => ({
        id: p.id,
        title: p.title,
        tasksCount: p.tasks.length,
        completedCount: p.tasks.filter(t => t.status === 'completed').length,
      })));
    }

    return projectsWithTasks;
  }),

  // Get all projects across all organizations the user is a member of
  getAllProjectsAcrossOrgs: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, ctx.session.user.id));

    const orgIds = memberships.map((m) => m.organizationId);

    // Fetch projects from all user's orgs + personal projects.
    // Avoid raw SQL interpolation for IN-clause.
    const projectsList = orgIds.length
      ? await ctx.db
          .select()
          .from(projects)
          .where(
            and(
              or(
                inArray(projects.organizationId, orgIds),
                and(eq(projects.createdById, ctx.session.user.id), isNull(projects.organizationId)),
              ),
              ne(projects.status, "archived"),
            ),
          )
          .orderBy(desc(projects.createdAt))
      : await ctx.db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.createdById, ctx.session.user.id),
              isNull(projects.organizationId),
              ne(projects.status, "archived"),
            ),
          )
          .orderBy(desc(projects.createdAt));

    // Get created by users
    const createdByIds = Array.from(new Set(projectsList.map((p) => p.createdById)));
    const createdByUsers = createdByIds.length
      ? await ctx.db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
          })
          .from(users)
          .where(inArray(users.id, createdByIds))
      : [];
    const createdByUserMap = new Map(createdByUsers.map((u) => [u.id, u] as const));

    // Avoid N+1: fetch all tasks for these projects in one query.
    const projectIds = projectsList.map((p) => p.id);
    const allTasks = projectIds.length
      ? await ctx.db
          .select({
            id: tasks.id,
            status: tasks.status,
            dueDate: tasks.dueDate,
            projectId: tasks.projectId,
          })
          .from(tasks)
          .where(inArray(tasks.projectId, projectIds))
      : [];

    const tasksByProjectId = allTasks.reduce((acc, t) => {
      (acc[t.projectId] ??= []).push({ id: t.id, status: t.status, dueDate: t.dueDate });
      return acc;
    }, {} as Record<number, Array<{ id: number; status: (typeof tasks.$inferSelect)["status"]; dueDate: Date | null }>>);

    return projectsList.map((project) => ({
      ...project,
      createdByUser: createdByUserMap.get(project.createdById) ?? null,
      tasks: tasksByProjectId[project.id] ?? [],
    }));
  }),

  
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
     
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id));

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("Fetching project:", {
          id: project.id,
          organizationId: project.organizationId,
          createdById: project.createdById,
        });
      }

      

      const isOwner = project.createdById === ctx.session.user.id;
      
      
      let hasOrgAccess = false;
      let isOrgMember = false;
      if (project.organizationId) {
        const [membership] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, project.organizationId),
              eq(organizationMembers.userId, ctx.session.user.id)
            )
          );
        hasOrgAccess = !!membership;
        isOrgMember = !!membership;
        if (process.env.NODE_ENV !== "production") {
          console.log("User has org access:", hasOrgAccess, "via membership:", !!membership);
        }
      }

      
      const [collaboration] = await ctx.db
        .select()
        .from(projectCollaborators)
        .where(
          and(
            eq(projectCollaborators.projectId, input.id),
            eq(projectCollaborators.collaboratorId, ctx.session.user.id)
          )
        );

      if (process.env.NODE_ENV !== "production") {
        console.log("Access check:", { isOwner, hasOrgAccess, isCollaborator: !!collaboration });
      }

      if (!isOwner && !collaboration && !hasOrgAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied - You don't have permission to view this project" });
      }

      
      const collaborators = await ctx.db
        .select({
          collaboratorId: projectCollaborators.collaboratorId,
          permission: projectCollaborators.permission,
          joinedAt: projectCollaborators.joinedAt,
          collaborator: {
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
          },
        })
        .from(projectCollaborators)
        .leftJoin(users, eq(projectCollaborators.collaboratorId, users.id))
        .where(eq(projectCollaborators.projectId, input.id));

      const [createdBy] = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        })
        .from(users)
        .where(eq(users.id, project.createdById))
        .limit(1);

     
      const projectTasks = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
          completedAt: tasks.completedAt,
          completionNote: tasks.completionNote,
          orderIndex: tasks.orderIndex,
          createdAt: tasks.createdAt,
          lastEditedAt: tasks.lastEditedAt,
       
          assignedToId: tasks.assignedToId,
          assignedToName: sql<string | null>`assigned_user.name`.as('assignedToName'),
          assignedToImage: sql<string | null>`assigned_user.image`.as('assignedToImage'),
       
          createdById: tasks.createdById,
          createdByName: sql<string | null>`creator_user.name`.as('createdByName'),
          createdByImage: sql<string | null>`creator_user.image`.as('createdByImage'),
     
          completedById: tasks.completedById,
          completedByName: sql<string | null>`completer_user.name`.as('completedByName'),
          completedByImage: sql<string | null>`completer_user.image`.as('completedByImage'),
          
          lastEditedById: tasks.lastEditedById,
          lastEditedByName: sql<string | null>`editor_user.name`.as('lastEditedByName'),
          lastEditedByImage: sql<string | null>`editor_user.image`.as('lastEditedByImage'),
        })
        .from(tasks)
        .leftJoin(sql`"user" AS assigned_user`, sql`${tasks.assignedToId} = assigned_user.id`)
        .leftJoin(sql`"user" AS creator_user`, sql`${tasks.createdById} = creator_user.id`)
        .leftJoin(sql`"user" AS completer_user`, sql`${tasks.completedById} = completer_user.id`)
        .leftJoin(sql`"user" AS editor_user`, sql`${tasks.lastEditedById} = editor_user.id`)
        .where(eq(tasks.projectId, input.id))
        .orderBy(tasks.orderIndex, tasks.createdAt);

      
      const formattedTasks = projectTasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        completedAt: task.completedAt,
        completionNote: task.completionNote,
        orderIndex: task.orderIndex,
        createdAt: task.createdAt,
        lastEditedAt: task.lastEditedAt,
        assignedTo: task.assignedToId
          ? {
              id: task.assignedToId,
              name: task.assignedToName,
              image: task.assignedToImage,
            }
          : null,
        createdBy: task.createdById
          ? {
              id: task.createdById,
              name: task.createdByName,
              image: task.createdByImage,
            }
          : null,
        completedBy: task.completedById
          ? {
              id: task.completedById,
              name: task.completedByName,
              image: task.completedByImage,
            }
          : null,
        lastEditedBy: task.lastEditedById
          ? {
              id: task.lastEditedById,
              name: task.lastEditedByName,
              image: task.lastEditedByImage,
            }
          : null,
      }));

      if (process.env.NODE_ENV !== "production") {
        console.log("Project tasks:", formattedTasks.length);
      }

      
      const hasWriteAccess = isOwner || isOrgMember || (collaboration?.permission === "write");

      return {
        ...project,
        createdBy: createdBy ?? null,
        collaborators,
        tasks: formattedTasks,
        userHasWriteAccess: hasWriteAccess,
      };
    }),

  
  addCollaborator: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        email: z.string().email(),
        permission: z.enum(["read", "write"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
        const [project] = await ctx.db
          .select()
          .from(projects)
          .where(eq(projects.id, input.projectId));

        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found. Please refresh and try again." });
        }

        if (project.createdById !== ctx.session.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can add collaborators." });
        }

        const [owner] = await ctx.db
          .select({
            name: users.name,
            email: users.email,
          })
          .from(users)
          .where(eq(users.id, ctx.session.user.id))
          .limit(1);

        const [userToAdd] = await ctx.db
          .select()
          .from(users)
          .where(eq(users.email, input.email));

        if (!userToAdd) {
          throw new TRPCError({ code: "NOT_FOUND", message: `No user found with email: ${input.email}. They must sign up first!` });
        }

        if (userToAdd.id === ctx.session.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You can't add yourself as a collaborator - you're already the owner!" });
        }

        const [existing] = await ctx.db
          .select()
          .from(projectCollaborators)
          .where(
            and(
              eq(projectCollaborators.projectId, input.projectId),
              eq(projectCollaborators.collaboratorId, userToAdd.id)
            )
          );

        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: `${input.email} is already a collaborator on this project.` });
        }

        await ctx.db.insert(projectCollaborators).values({
          projectId: input.projectId,
          collaboratorId: userToAdd.id,
          permission: input.permission,
        });

        const ownerName = owner?.name ?? owner?.email ?? "Someone";
        const permissionText = input.permission === "write" ? "edit" : "view";

        // Create notification (best-effort — don't fail the mutation if notification fails)
        const projectLink = `/projects`;
        try {
          const [notification] = await ctx.db.insert(notifications).values({
            userId: userToAdd.id,
            type: "project",
            title: "New Project Invitation",
            message: `${ownerName} invited you to ${permissionText} "${project.title}"`,
            link: projectLink,
            read: false,
          }).returning();

          if (notification) {
            emitNotification(userToAdd.id, {
              id: notification.id,
              type: "project",
              title: "New Project Invitation",
              message: `${ownerName} invited you to ${permissionText} "${project.title}"`,
              link: projectLink,
            });
          }
        } catch (notifError) {
          console.error("Failed to create notification (collaborator was still added):", notifError);
        }

        return { 
          success: true,
          message: `Successfully added ${userToAdd.name ?? input.email} as a collaborator!`,
          user: {
            id: userToAdd.id,
            name: userToAdd.name,
            email: userToAdd.email,
            image: userToAdd.image,
          }
        };
    }),

  
  removeCollaborator: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        collaboratorId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId));

      if (project?.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only project owner can remove collaborators" });
      }

      await ctx.db
        .delete(projectCollaborators)
        .where(
          and(
            eq(projectCollaborators.projectId, input.projectId),
            eq(projectCollaborators.collaboratorId, input.collaboratorId)
          )
        );

      return { success: true };
    }),

  
  updateCollaboratorPermission: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        collaboratorId: z.string(),
        permission: z.enum(["read", "write"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId));

      if (project?.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only project owner can update permissions" });
      }

      await ctx.db
        .update(projectCollaborators)
        .set({ permission: input.permission })
        .where(
          and(
            eq(projectCollaborators.projectId, input.projectId),
            eq(projectCollaborators.collaboratorId, input.collaboratorId)
          )
        );

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id));

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      if (project.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can delete this project" });
      }

      // Ownership is necessary but not sufficient inside an organization: the
      // permission columns are the source of truth, so a member whose capability
      // was revoked cannot delete a project they once created.
      //
      // No `canDeleteProjects` column exists, so this uses `canDeleteTasks` — the
      // one destructive capability that is a column. A contributor may edit a
      // project without being able to destroy it, which matches both the original
      // role matrix and the client-side shape in `~/lib/permissions`.
      await assertProjectPermission(ctx, input.id, "canDeleteTasks");

      await ctx.db.delete(projects).where(eq(projects.id, input.id));

      return { success: true };
    }),

  archiveProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId));

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      if (project.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can archive this project" });
      }

      await assertProjectPermission(ctx, input.projectId, "canEditProjects");

      await ctx.db
        .update(projects)
        .set({ status: "archived" })
        .where(eq(projects.id, input.projectId));

      return { success: true };
    }),

  reopenProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId));

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      if (project.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can reopen this project" });
      }

      await assertProjectPermission(ctx, input.projectId, "canEditProjects");

      await ctx.db
        .update(projects)
        .set({ status: "active" })
        .where(eq(projects.id, input.projectId));

      return { success: true };
    }),
});