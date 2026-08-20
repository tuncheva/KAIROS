import { z } from "zod";

import { TRPCError } from "@trpc/server";
import { eq, and, desc, inArray, or, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { assertProjectAccess } from "~/server/api/authz";
import {
  users,
  projects,
  tasks,
  taskActivityLog,
  notifications,
  organizations,
  organizationMembers,
  projectCollaborators,
  events,
} from "~/server/db/schema";

export type A1ReadToolName =
  | "getSessionContext"
  | "listOrganizations"
  | "listProjects"
  | "getProjectDetail"
  | "listTasks"
  | "getTaskDetail"
  | "listNotifications"
  | "listEventsPublic";

export interface A1Tool<TName extends A1ReadToolName, TInput, TOutput> {
  name: TName;
  inputSchema: z.ZodType<TInput>;
  execute: (ctx: TRPCContext, input: TInput) => Promise<TOutput>;
  outputSchema: z.ZodType<TOutput>;
}

export type A1ReadToolsMap = {
  getSessionContext: typeof getSessionContextTool;
  listOrganizations: typeof listOrganizationsTool;
  listProjects: typeof listProjectsTool;
  getProjectDetail: typeof getProjectDetailTool;
  listTasks: typeof listTasksTool;
  getTaskDetail: typeof getTaskDetailTool;
  listNotifications: typeof listNotificationsTool;
  listEventsPublic: typeof listEventsPublicTool;
};

// ---- getSessionContext

type GetSessionContextInput = Record<string, never>;
const GetSessionContextInputSchema = z.object({}).strict();

type GetSessionContextOutput = {
  userId: string;
  email: string | null;
  name: string | null;
  image: string | null;
  activeOrganizationId: number | null;
};

const GetSessionContextOutputSchema = z
  .object({
    userId: z.string().min(1),
    email: z.string().email().nullable(),
    name: z.string().nullable(),
    image: z.string().url().nullable(),
    activeOrganizationId: z.number().nullable(),
  })
  .strict();

export const getSessionContextTool: A1Tool<
  "getSessionContext",
  GetSessionContextInput,
  GetSessionContextOutput
> = {
  name: "getSessionContext",
  inputSchema: GetSessionContextInputSchema,
  outputSchema: GetSessionContextOutputSchema,
  async execute(ctx) {
    const userId = ctx.session?.user?.id;
    const user = ctx.session?.user;
    if (!userId || !user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    let activeOrganizationId: number | null = null;
    try {
      const [row] = await ctx.db
        .select({ activeOrganizationId: users.activeOrganizationId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      activeOrganizationId = row?.activeOrganizationId ?? null;
    } catch {
      // Backwards-compat: DB may not have this column yet.
      activeOrganizationId = null;
    }

    return {
      userId,
      email: user.email ?? null,
      name: user.name ?? null,
      image: user.image ?? null,
      activeOrganizationId,
    };
  },
};

// ---- listProjects

type ListProjectsInput = {
  limit?: number;
};

const ListProjectsInputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

type ListProjectsOutput = Array<{
  id: number;
  title: string;
  description: string | null;
  createdAt: Date;
  status: string;
  organizationId: number | null;
}>;

const ListProjectsOutputSchema = z.array(
  z
    .object({
      id: z.number(),
      title: z.string(),
      description: z.string().nullable(),
      createdAt: z.date(),
      status: z.string(),
      organizationId: z.number().nullable(),
    })
    .strict(),
);

export const listProjectsTool: A1Tool<
  "listProjects",
  ListProjectsInput,
  ListProjectsOutput
> = {
  name: "listProjects",
  inputSchema: ListProjectsInputSchema,
  outputSchema: ListProjectsOutputSchema,
  async execute(ctx, input) {
    const userId = ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const limit = input.limit ?? 20;

    // Filtering on `createdById` alone made the agent blind to every project the
    // user is a member or collaborator on but did not create — which is exactly
    // the collaborative case it exists to help with. It would answer "you have no
    // projects" to someone working in a team workspace all day.
    //
    // The visible set matches what `assertProjectAccess` will allow: projects the
    // user owns, projects in an organization they belong to, and projects they
    // collaborate on directly.
    const [memberships, collaborations] = await Promise.all([
      ctx.db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, userId)),
      ctx.db
        .select({ projectId: projectCollaborators.projectId })
        .from(projectCollaborators)
        .where(eq(projectCollaborators.collaboratorId, userId)),
    ]);

    const orgIds = memberships.map((m) => m.organizationId);
    const collabProjectIds = collaborations.map((c) => c.projectId);

    const visible = or(
      eq(projects.createdById, userId),
      ...(orgIds.length ? [inArray(projects.organizationId, orgIds)] : []),
      ...(collabProjectIds.length ? [inArray(projects.id, collabProjectIds)] : []),
    );

    const rows = await ctx.db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        createdAt: projects.createdAt,
        status: projects.status,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(visible)
      .orderBy(desc(projects.createdAt))
      .limit(limit);

    return rows;
  },
};

// ---- listTasks

type ListTasksInput = {
  projectId: number;
  limit?: number;
  status?: "pending" | "in_progress" | "completed" | "blocked";
};

const ListTasksInputSchema = z
  .object({
    projectId: z.number(),
    limit: z.number().int().min(1).max(50).optional(),
    status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
  })
  .strict();

type ListTasksOutput = Array<{
  id: number;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: Date | null;
  updatedAt: Date;
}>;

const ListTasksOutputSchema = z.array(
  z
    .object({
      id: z.number(),
      title: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "blocked"]),
      priority: z.enum(["low", "medium", "high", "urgent"]),
      dueDate: z.date().nullable(),
      updatedAt: z.date(),
    })
    .strict(),
);

export const listTasksTool: A1Tool<"listTasks", ListTasksInput, ListTasksOutput> = {
  name: "listTasks",
  inputSchema: ListTasksInputSchema,
  outputSchema: ListTasksOutputSchema,
  async execute(ctx, input) {
    const limit = input.limit ?? 20;

    // The projectId reaches this tool from caller-supplied agent scope, so it
    // must be authorized here — this is not a trusted internal value.
    await assertProjectAccess(ctx, input.projectId, "read");

    const where =
      input.status !== undefined
        ? and(eq(tasks.projectId, input.projectId), eq(tasks.status, input.status))
        : eq(tasks.projectId, input.projectId);

    const rows = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.updatedAt))
      .limit(limit);

    return rows;
  },
};

// ---- listNotifications

type ListNotificationsInput = {
  limit?: number;
};

const ListNotificationsInputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

type ListNotificationsOutput = Array<{
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: Date;
}>;

const ListNotificationsOutputSchema = z.array(
  z
    .object({
      id: z.number(),
      type: z.string(),
      title: z.string(),
      message: z.string(),
      link: z.string().nullable(),
      read: z.boolean(),
      createdAt: z.date(),
    })
    .strict(),
);

export const listNotificationsTool: A1Tool<
  "listNotifications",
  ListNotificationsInput,
  ListNotificationsOutput
> = {
  name: "listNotifications",
  inputSchema: ListNotificationsInputSchema,
  outputSchema: ListNotificationsOutputSchema,
  async execute(ctx, input) {
    const userId = ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const limit = input.limit ?? 20;

    const rows = await ctx.db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        link: notifications.link,
        read: notifications.read,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    return rows;
  },
};

// ---- listOrganizations

type ListOrganizationsInput = Record<string, never>;
type ListOrganizationsOutput = Array<{
  id: number;
  name: string;
  role: string;
  memberCount: number;
}>;

export const listOrganizationsTool: A1Tool<
  "listOrganizations",
  ListOrganizationsInput,
  ListOrganizationsOutput
> = {
  name: "listOrganizations",
  inputSchema: z.object({}).strict() as z.ZodType<ListOrganizationsInput>,
  outputSchema: z.array(
    z
      .object({
        id: z.number(),
        name: z.string(),
        role: z.string(),
        memberCount: z.number(),
      })
      .strict(),
  ),
  async execute(ctx) {
    const userId = ctx.session?.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

    // Only organizations the caller belongs to: membership is the read boundary
    // for org data everywhere else in the app, and the agent is not an exception.
    const rows = await ctx.db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: organizationMembers.role,
        memberCount: sql<number>`(
          SELECT count(*) FROM ${organizationMembers} AS m
          WHERE m.organization_id = ${organizations.id}
        )`.mapWith(Number),
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(eq(organizationMembers.userId, userId))
      .limit(50);

    return rows;
  },
};

// ---- getProjectDetail

type GetProjectDetailInput = { projectId: number };
type GetProjectDetailOutput = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  organizationId: number | null;
  taskCounts: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    blocked: number;
  };
  overdueTasks: number;
  collaborators: Array<{ id: string; name: string | null }>;
};

export const getProjectDetailTool: A1Tool<
  "getProjectDetail",
  GetProjectDetailInput,
  GetProjectDetailOutput
> = {
  name: "getProjectDetail",
  inputSchema: z.object({ projectId: z.number() }).strict(),
  outputSchema: z.custom<GetProjectDetailOutput>(),
  async execute(ctx, input) {
    // Caller-supplied id straight off the model's tool call — authorize first.
    await assertProjectAccess(ctx, input.projectId, "read");

    const [project] = await ctx.db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        status: projects.status,
        createdAt: projects.createdAt,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    const taskRows = await ctx.db
      .select({ status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(eq(tasks.projectId, input.projectId));

    const now = new Date();
    const taskCounts = {
      total: taskRows.length,
      pending: taskRows.filter((t) => t.status === "pending").length,
      inProgress: taskRows.filter((t) => t.status === "in_progress").length,
      completed: taskRows.filter((t) => t.status === "completed").length,
      blocked: taskRows.filter((t) => t.status === "blocked").length,
    };
    const overdueTasks = taskRows.filter(
      (t) => t.dueDate && t.dueDate < now && t.status !== "completed",
    ).length;

    const collaborators = await ctx.db
      .select({ id: users.id, name: users.name })
      .from(projectCollaborators)
      .innerJoin(users, eq(projectCollaborators.collaboratorId, users.id))
      .where(eq(projectCollaborators.projectId, input.projectId))
      .limit(50);

    return { ...project, taskCounts, overdueTasks, collaborators };
  },
};

// ---- getTaskDetail

type GetTaskDetailInput = { taskId: number };
type GetTaskDetailOutput = {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  assignedToId: string | null;
  assignedToName: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  recentActivity: Array<{
    action: string;
    newValue: string | null;
    createdAt: Date;
  }>;
};

export const getTaskDetailTool: A1Tool<
  "getTaskDetail",
  GetTaskDetailInput,
  GetTaskDetailOutput
> = {
  name: "getTaskDetail",
  inputSchema: z.object({ taskId: z.number() }).strict(),
  outputSchema: z.custom<GetTaskDetailOutput>(),
  async execute(ctx, input) {
    const [task] = await ctx.db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        assignedToId: tasks.assignedToId,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);

    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
    }

    // A task is readable exactly when its project is. Checked after the lookup
    // because the project id comes from the row, not from the caller.
    await assertProjectAccess(ctx, task.projectId, "read");

    let assignedToName: string | null = null;
    if (task.assignedToId) {
      const [assignee] = await ctx.db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, task.assignedToId))
        .limit(1);
      assignedToName = assignee?.name ?? null;
    }

    const recentActivity = await ctx.db
      .select({
        action: taskActivityLog.action,
        newValue: taskActivityLog.newValue,
        createdAt: taskActivityLog.createdAt,
      })
      .from(taskActivityLog)
      .where(eq(taskActivityLog.taskId, input.taskId))
      .orderBy(desc(taskActivityLog.createdAt))
      .limit(10);

    return { ...task, assignedToName, recentActivity };
  },
};

// ---- listEventsPublic

type ListEventsPublicInput = { limit?: number };
type ListEventsPublicOutput = Array<{
  id: number;
  title: string;
  description: string;
  eventDate: Date;
  region: string;
  isOwner: boolean;
  enableRsvp: boolean;
}>;

export const listEventsPublicTool: A1Tool<
  "listEventsPublic",
  ListEventsPublicInput,
  ListEventsPublicOutput
> = {
  name: "listEventsPublic",
  inputSchema: z
    .object({ limit: z.number().int().min(1).max(50).optional() })
    .strict(),
  outputSchema: z.custom<ListEventsPublicOutput>(),
  async execute(ctx, input) {
    const userId = ctx.session?.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

    // The event feed is public to signed-in users, matching `buildA4Context`.
    const rows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        eventDate: events.eventDate,
        region: events.region,
        createdById: events.createdById,
        enableRsvp: events.enableRsvp,
      })
      .from(events)
      .orderBy(desc(events.eventDate))
      .limit(input.limit ?? 20);

    return rows.map(({ createdById, ...e }) => ({
      ...e,
      isOwner: createdById === userId,
    }));
  },
};

export const A1_READ_TOOLS: A1ReadToolsMap = {
  getSessionContext: getSessionContextTool,
  listOrganizations: listOrganizationsTool,
  listProjects: listProjectsTool,
  getProjectDetail: getProjectDetailTool,
  listTasks: listTasksTool,
  getTaskDetail: getTaskDetailTool,
  listNotifications: listNotificationsTool,
  listEventsPublic: listEventsPublicTool,
};
