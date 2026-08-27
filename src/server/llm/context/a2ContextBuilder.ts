import { eq, desc } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { projects, tasks, projectCollaborators, users } from "~/server/db/schema";
import { resolveUserLocale, type SupportedLocale } from "~/server/llm/locale";
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
  /**
   * The user's saved interface language.
   *
   * The fallback reply language when the message itself gives nothing to detect
   * from — a sub-agent reached through a handoff often sees a short rephrased
   * intent rather than the sentence the user typed.
   */
  locale: SupportedLocale;
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

  const [memory, locale] = await Promise.all([
    loadUserMemory(input.ctx, userId, "task_planner"),
    resolveUserLocale(input.ctx, userId),
  ]);

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
      locale,
      memory,
    };
  }

  // One round trip each, and every one of them was awaited in turn: project,
  // then tasks, then collaborators, then the owner. Against a hosted database
  // that is four latencies stacked in front of a turn the user is already
  // waiting on, for four queries that do not depend on each other. Only the
  // access check needs the project row first, and it is cheap to hold the tasks
  // and collaborators we fetched alongside it.
  const [projectRows, existingTasks, collaborators] = await Promise.all([
    input.ctx.db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        createdById: projects.createdById,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
    input.ctx.db
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
      .limit(50),
    input.ctx.db
      .select({
        id: users.id,
        name: users.name,
      })
      .from(projectCollaborators)
      .innerJoin(users, eq(projectCollaborators.collaboratorId, users.id))
      .where(eq(projectCollaborators.projectId, projectId)),
  ]);

  const project = projectRows[0];
  if (!project) {
    throw new Error("Project not found");
  }

  // Authorization: reuse the same logic as current agent task generation (owner or collaborator).
  // NOTE: write permissions are enforced at apply-time by taskRouter.
  //
  // Nothing above this line was returned to the caller, and the queries it
  // races are all scoped to the project id the caller named — so failing here
  // still fails closed, it just fails a few reads later than it used to.
  if (project.createdById !== userId) {
    if (!collaborators.some((c) => c.id === userId)) {
      throw new Error("You do not have access to this project");
    }
  }

  // The owner is in `collaborators` already whenever they collaborate on their
  // own project; otherwise they are one extra lookup, and only then.
  const owner =
    collaborators.find((c) => c.id === project.createdById) ??
    (
      await input.ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, project.createdById))
        .limit(1)
    )[0];

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
    locale,
    memory,
  };
}
