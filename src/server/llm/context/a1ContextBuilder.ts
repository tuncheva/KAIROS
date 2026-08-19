/**
 * Context Builder for the Workspace Concierge (A1).
 *
 * Assembles a small, relevant, token-bounded context pack from the DB
 * that gets injected into the system prompt for LLM calls.
 */
import type { TRPCContext } from "~/server/api/trpc";
import { assertProjectAccess } from "~/server/api/authz";
import { A1_READ_TOOLS } from "~/server/llm/tools/a1/readTools";

export interface A1ContextPack {
  session: {
    userId: string;
    email: string | null;
    name: string | null;
    activeOrganizationId: number | null;
  };
  projects: Array<{
    id: number;
    title: string;
    description: string | null;
    status: string;
  }>;
  tasks: Array<{
    id: number;
    projectId: number;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
  }>;
  notifications: Array<{
    id: number;
    type: string;
    title: string;
    message: string;
    read: boolean;
  }>;
  projectDetail?: {
    id: number;
    title: string;
    description: string | null;
    status: string;
  } | null;
  now: string;
}

/**
 * Build a context pack for A1 from the database.
 */
export async function buildA1Context(
  ctx: TRPCContext,
  scope?: { orgId?: string | number; projectId?: string | number },
): Promise<A1ContextPack> {
  // 1. Session context
  const sessionResult = await A1_READ_TOOLS.getSessionContext.execute(ctx, {} as never);

  // 2. Projects
  // Always load a summary of user's projects so the LLM can mention them.
  // When scoped to a specific project, we load more detail for that project.
  const projectId = scope?.projectId
    ? typeof scope.projectId === "string"
      ? Number(scope.projectId)
      : scope.projectId
    : null;

  // `scope.projectId` is caller-supplied. Authorize it before any project-scoped
  // read so an unauthorized id fails closed rather than building a partial pack.
  if (projectId !== null && Number.isFinite(projectId)) {
    await assertProjectAccess(ctx, projectId, "read");
  }

  const projectsResult = await A1_READ_TOOLS.listProjects.execute(ctx, { limit: 10 });

  // 3. Notifications — load for workspace overview or project-scoped.
  const notificationsResult = await A1_READ_TOOLS.listNotifications.execute(ctx, { limit: 10 });

  // 4. Tasks
  let tasksResult: Array<{
    id: number;
    projectId: number;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    updatedAt: Date;
  }> = [];

  if (projectId && Number.isFinite(projectId)) {
    // Project-scoped: load tasks for the specific project
    const rawTasks = await A1_READ_TOOLS.listTasks.execute(ctx, {
      projectId,
      limit: 20,
    });
    tasksResult = rawTasks.map((t) => ({ ...t, projectId }));
  } else if (projectsResult.length > 0) {
    // Workspace-scoped: load tasks from ALL projects so the AI can analyze overall progress
    for (const proj of projectsResult) {
      const projectTasks = await A1_READ_TOOLS.listTasks.execute(ctx, {
        projectId: proj.id,
        limit: 10,
      });
      tasksResult.push(...projectTasks.map((t) => ({ ...t, projectId: proj.id })));
    }
  }

  // 5. Optional project detail
  let projectDetail = null;
  if (projectId && Number.isFinite(projectId)) {
    const found = projectsResult.find((p) => p.id === projectId);
    if (found) {
      projectDetail = {
        id: found.id,
        title: found.title,
        description: found.description,
        status: found.status,
      };
    }
  }

  return {
    session: {
      userId: sessionResult.userId,
      email: sessionResult.email,
      name: sessionResult.name,
      activeOrganizationId: sessionResult.activeOrganizationId,
    },
    projects: projectsResult.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
    })),
    tasks: tasksResult.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
    })),
    notifications: notificationsResult.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      read: n.read,
    })),
    projectDetail,
    now: new Date().toISOString(),
  };
}
