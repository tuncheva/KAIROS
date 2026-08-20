/**
 * Seed context for the Workspace Concierge (A1).
 *
 * Deliberately small. This used to assemble the whole answer up front — ten
 * projects, ten tasks from each, ten notifications — and paste it into the system
 * prompt as JSON. That cost 30-40 queries per message (a `listTasks` plus an
 * access check for every project), blew the cacheable prompt prefix on every
 * turn, and still could not answer a question about the eleventh project.
 *
 * A1 has tools now. This pack exists only to tell the model what *exists*, so it
 * can pick the right id to look up: who the user is, which projects they have,
 * and what today is. Everything else is fetched on demand.
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
  /** Just enough to resolve a project the user names. Details come from tools. */
  projects: Array<{
    id: number;
    title: string;
    status: string;
  }>;
  /** The project the UI is currently scoped to, if any. */
  scopedProjectId: number | null;
  now: string;
}

export async function buildA1Context(
  ctx: TRPCContext,
  scope?: { orgId?: string | number; projectId?: string | number },
): Promise<A1ContextPack> {
  const sessionResult = await A1_READ_TOOLS.getSessionContext.execute(
    ctx,
    {} as never,
  );

  const rawProjectId = scope?.projectId;
  const projectId =
    typeof rawProjectId === "string"
      ? Number(rawProjectId)
      : typeof rawProjectId === "number"
        ? rawProjectId
        : null;

  // `scope.projectId` is caller-supplied. Authorize it before it reaches the
  // prompt so an unauthorized id fails closed rather than being echoed back.
  const scopedProjectId =
    projectId !== null && Number.isFinite(projectId) ? projectId : null;
  if (scopedProjectId !== null) {
    await assertProjectAccess(ctx, scopedProjectId, "read");
  }

  const projects = await A1_READ_TOOLS.listProjects.execute(ctx, { limit: 25 });

  return {
    session: {
      userId: sessionResult.userId,
      email: sessionResult.email,
      name: sessionResult.name,
      activeOrganizationId: sessionResult.activeOrganizationId,
    },
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
    })),
    scopedProjectId,
    now: new Date().toISOString(),
  };
}
