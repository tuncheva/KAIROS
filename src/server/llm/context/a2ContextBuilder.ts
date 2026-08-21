import { eq, desc } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { projects, tasks, projectCollaborators, users } from "~/server/db/schema";
import { loadUserMemory, type MemoryFact } from "~/server/llm/memory";

export interface A2ContextPack {
  session: {
    userId: string;
    activeOrganizationId?: number | null;
  };
  scope: {
    orgId?: string | number;
    projectId?: number;
  };
  project?: {
    id: number;
    title: string;
    description: string | null;
    createdById: string;
  };
  /** Available projects when no specific projectId is in scope */
  availableProjects?: Array<{ id: number; title: string }>;
  collaborators: Array<{ id: string; name: string | null }>;
  existingTasks: Array<{
    id: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    assignedToId: string | null;
    orderIndex: number;
    dueDate: Date | null;
  }>;
  handoffContext?: Record<string, unknown>;
  /** Global facts plus any the user set for the Task Planner specifically. */
  memory: MemoryFact[];
}

export async function buildA2Context(input: {
  ctx: TRPCContext;
  scope?: { orgId?: string | number; projectId?: number };
  handoffContext?: Record<string, unknown>;
}): Promise<A2ContextPack> {
  const userId = input.ctx.session?.user?.id;
  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }

  // The NextAuth session user type in this codebase doesn't currently include
  // activeOrganizationId (even though it exists in the DB). Keep it optional.
  const activeOrganizationId: number | null | undefined = undefined;

  const scope = input.scope ?? {};
  const projectId = scope.projectId;

  const memory = await loadUserMemory(input.ctx, userId, "task_planner");

  // Minimal pack when projectId missing; include available projects so A2 can reference them.
  if (!projectId) {
    const userProjects = await input.ctx.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.createdById, userId));

    return {
      session: { userId, activeOrganizationId },
      scope,
      collaborators: [],
      existingTasks: [],
      availableProjects: userProjects,
      handoffContext: input.handoffContext,
      memory,
    };
  }

  const [project] = await input.ctx.db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      createdById: projects.createdById,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new Error("Project not found");
  }

  // Authorization: reuse the same logic as current agent task generation (owner or collaborator).
  // NOTE: write permissions are enforced at apply-time by taskRouter.
  if (project.createdById !== userId) {
    const [collab] = await input.ctx.db
      .select({ collaboratorId: projectCollaborators.collaboratorId })
      .from(projectCollaborators)
      .where(eq(projectCollaborators.projectId, projectId))
      .limit(1);

    if (collab?.collaboratorId !== userId) {
      throw new Error("You do not have access to this project");
    }
  }

  const existingTasks = await input.ctx.db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      assignedToId: tasks.assignedToId,
      orderIndex: tasks.orderIndex,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt))
    .limit(50);

  const collaborators = await input.ctx.db
    .select({
      id: users.id,
      name: users.name,
    })
    .from(projectCollaborators)
    .innerJoin(users, eq(projectCollaborators.collaboratorId, users.id))
    .where(eq(projectCollaborators.projectId, projectId));

  // Include owner if not already present
  const [owner] = await input.ctx.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, project.createdById))
    .limit(1);

  const deduped = new Map<string, { id: string; name: string | null }>();
  for (const u of [...(owner ? [owner] : []), ...collaborators]) {
    deduped.set(u.id, u);
  }

  return {
    session: { userId, activeOrganizationId },
    scope,
    project,
    collaborators: [...deduped.values()],
    existingTasks,
    handoffContext: input.handoffContext,
    memory,
  };
}
