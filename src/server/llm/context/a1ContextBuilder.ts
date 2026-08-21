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
 *
 * Two things were added that genuinely belong up front, because the model cannot
 * discover them by looking: the user's language preference (G-2) and the durable
 * facts they have asked the assistant to remember (C-2).
 */
import type { TRPCContext } from "~/server/api/trpc";
import { eq } from "drizzle-orm";

import { assertProjectAccess } from "~/server/api/authz";
import { users } from "~/server/db/schema";
import { loadUserMemory, type MemoryFact } from "~/server/llm/memory";
import { A1_READ_TOOLS } from "~/server/llm/tools/a1/readTools";

/** The locales KAIROS ships message files for. */
export type SupportedLocale = "en" | "bg" | "es" | "fr" | "de";

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  bg: "Bulgarian (български)",
  es: "Spanish (español)",
  fr: "French (français)",
  de: "German (Deutsch)",
};

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
  /** The user's saved interface language — the default for the reply. */
  locale: SupportedLocale;
  /** Facts the user asked to be remembered, newest wins per key. */
  memory: MemoryFact[];
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

  const [projects, memory, localeRow] = await Promise.all([
    A1_READ_TOOLS.listProjects.execute(ctx, { limit: 25 }),
    loadUserMemory(ctx, sessionResult.userId, "workspace_concierge"),
    ctx.db
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, sessionResult.userId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
      // The column is `notNull` with a default, but a stale session against a
      // pre-migration database should degrade to English rather than 500.
      .catch(() => null),
  ]);

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
    locale: (localeRow?.language ?? "en") as SupportedLocale,
    memory,
    now: new Date().toISOString(),
  };
}
