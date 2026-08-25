import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  organizationMembers,
  projectCollaborators,
  projects,
  tasks,
  users,
} from "~/server/db/schema";
import { and, count, eq, inArray, isNull, max, ne, or, sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/*  /progress — a person's record of finished work.                    */
/*                                                                    */
/*  Everything here answers "who finished what, and when", so it reads */
/*  `tasks.completed_at` / `tasks.completed_by_id` rather than the     */
/*  activity log: the log records the click, the task columns record   */
/*  the outcome, and the outcome is what survives a task being         */
/*  reopened and finished again.                                       */
/*                                                                    */
/*  Rows written before those columns existed have them NULL, so both  */
/*  fall back to `updated_at` / `last_edited_by_id`. Without that the  */
/*  grid of an existing workspace would render empty, which is worse   */
/*  than attributing an old completion to whoever last touched it.     */
/* ------------------------------------------------------------------ */

/**
 * Local `coalesce` for the finish timestamp — see the note above.
 *
 * `mapWith` matters: a bare `sql` fragment hands back whatever text postgres
 * printed ("2026-08-21 07:02:40.837+00"), which only lenient date parsers
 * accept. Borrowing the column's own mapper turns it into a Date here, so it
 * crosses the wire as one instead of as a string each browser must guess at.
 */
const finishedAt = sql`coalesce(${tasks.completedAt}, ${tasks.updatedAt})`.mapWith(
  tasks.completedAt,
);
/** Local `coalesce` for the person credited with the finish. */
const finishedBy = sql<string>`coalesce(${tasks.completedById}, ${tasks.lastEditedById})`;

/** Highest first — the order `nextTask` picks in. */
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type Ctx = Parameters<Parameters<typeof protectedProcedure.query>[0]>[0]["ctx"];

type Scope = {
  mode: "organization" | "personal";
  /** Non-archived projects the caller may read. */
  projectIds: number[];
  /** People whose record the caller may open. */
  memberIds: string[];
};

/**
 * Which projects and people this page covers.
 *
 * Deliberately the same rule as `project.getMyProjects`: with an active
 * organisation the workspace is that organisation, otherwise it is the
 * caller's own projects plus the ones they collaborate on. A leaderboard that
 * counted work the caller cannot see in /projects would be a disclosure, so
 * the two must not drift apart.
 */
async function resolveScope(ctx: Ctx): Promise<Scope> {
  const me = ctx.session.user.id;

  let activeOrganizationId: number | null = null;
  try {
    const [row] = await ctx.db
      .select({ activeOrganizationId: users.activeOrganizationId })
      .from(users)
      .where(eq(users.id, me))
      .limit(1);
    activeOrganizationId = row?.activeOrganizationId ?? null;
  } catch (err) {
    // Databases that predate the column fall back to personal scope.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("active_organization_id")) throw err;
    activeOrganizationId = null;
  }

  const [membership] = activeOrganizationId
    ? await ctx.db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, me),
            eq(organizationMembers.organizationId, activeOrganizationId),
          ),
        )
        .limit(1)
    : [undefined];

  if (membership) {
    const [projectRows, memberRows] = await Promise.all([
      ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, membership.organizationId),
            ne(projects.status, "archived"),
          ),
        ),
      ctx.db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, membership.organizationId)),
    ]);

    return {
      mode: "organization",
      projectIds: projectRows.map((p) => p.id),
      memberIds: Array.from(new Set([me, ...memberRows.map((m) => m.userId)])),
    };
  }

  const collaborating = await ctx.db
    .select({ projectId: projectCollaborators.projectId })
    .from(projectCollaborators)
    .where(eq(projectCollaborators.collaboratorId, me));
  const collabIds = collaborating.map((c) => c.projectId);

  const projectRows = await ctx.db
    .select({ id: projects.id, createdById: projects.createdById })
    .from(projects)
    .where(
      and(
        or(
          and(eq(projects.createdById, me), isNull(projects.organizationId)),
          ...(collabIds.length ? [inArray(projects.id, collabIds)] : []),
        ),
        ne(projects.status, "archived"),
      ),
    );
  const projectIds = projectRows.map((p) => p.id);

  const peers = projectIds.length
    ? await ctx.db
        .select({ userId: projectCollaborators.collaboratorId })
        .from(projectCollaborators)
        .where(inArray(projectCollaborators.projectId, projectIds))
    : [];

  return {
    mode: "personal",
    projectIds,
    memberIds: Array.from(
      new Set([me, ...projectRows.map((p) => p.createdById), ...peers.map((p) => p.userId)]),
    ),
  };
}

export const progressRouter = createTRPCRouter({
  /**
   * Tasks completed all time, per person, across the visible workspace.
   * Drives the leaderboard blocks; clicking one opens that person's record.
   */
  getLeaderboard: protectedProcedure.query(async ({ ctx }) => {
    const scope = await resolveScope(ctx);
    const me = ctx.session.user.id;

    if (!scope.projectIds.length) {
      return { scope: scope.mode, people: [] as LeaderboardPerson[] };
    }

    const tallies = await ctx.db
      .select({ userId: finishedBy, completed: count() })
      .from(tasks)
      .where(and(inArray(tasks.projectId, scope.projectIds), eq(tasks.status, "completed")))
      .groupBy(finishedBy);

    const byUser = new Map<string, number>();
    for (const row of tallies) {
      if (!row.userId) continue;
      byUser.set(row.userId, Number(row.completed));
    }
    // The caller always gets a block, even at zero, so the page never renders
    // a leaderboard the reader cannot find themselves in.
    if (!byUser.has(me)) byUser.set(me, 0);

    const ids = Array.from(byUser.keys());
    const people = await ctx.db
      .select({ id: users.id, name: users.name, email: users.email, image: users.image })
      .from(users)
      .where(inArray(users.id, ids));

    const ranked: LeaderboardPerson[] = people
      .map((p) => ({ ...p, completed: byUser.get(p.id) ?? 0, isSelf: p.id === me }))
      .sort((a, b) => b.completed - a.completed || (a.name ?? "").localeCompare(b.name ?? ""));

    return { scope: scope.mode, people: ranked };
  }),

  /**
   * One person's record: what they finished inside the window, what is still
   * open on them, and the single task worth picking up next.
   *
   * `finishedAt` timestamps come back raw — the client buckets them into local
   * days, because which day a 23:40 completion belongs to is a question only
   * the reader's clock can answer.
   */
  getRecord: protectedProcedure
    .input(
      z
        .object({
          /** Defaults to the caller. Must be someone in the same workspace. */
          userId: z.string().max(255).optional(),
          /** How far back the grid reaches. 18 weeks plus a day of slack. */
          days: z.number().int().min(7).max(400).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx);
      const me = ctx.session.user.id;
      const targetId = input?.userId ?? me;
      const days = input?.days ?? 133;

      if (targetId !== me && !scope.memberIds.includes(targetId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That person is not part of this workspace",
        });
      }

      const [person] = await ctx.db
        .select({ id: users.id, name: users.name, email: users.email, image: users.image })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);

      if (!person) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      }

      const empty = {
        scope: scope.mode,
        person,
        isSelf: targetId === me,
        days,
        allTimeCompleted: 0,
        entries: [] as RecordEntryRow[],
        workload: [] as WorkloadRow[],
        nextTask: null as NextTaskRow | null,
      };
      if (!scope.projectIds.length) return empty;

      const inScope = inArray(tasks.projectId, scope.projectIds);
      const finishedByTarget = and(
        inScope,
        eq(tasks.status, "completed"),
        sql`coalesce(${tasks.completedById}, ${tasks.lastEditedById}) = ${targetId}`,
      );
      // ISO text, not a Date: a raw `sql` fragment binds its parameters
      // untyped, and postgres.js cannot serialise a Date that way — only
      // drizzle's typed column helpers know to convert one. Postgres casts the
      // string to timestamptz itself.
      const since = new Date(Date.now() - days * 86_400_000).toISOString();

      const [entryRows, allTimeRows, openRows, projectTouchRows] = await Promise.all([
        ctx.db
          .select({
            id: tasks.id,
            title: tasks.title,
            projectId: tasks.projectId,
            projectTitle: projects.title,
            createdAt: tasks.createdAt,
            finishedAt,
          })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .where(
            and(
              finishedByTarget,
              sql`coalesce(${tasks.completedAt}, ${tasks.updatedAt}) >= ${since}`,
            ),
          )
          .orderBy(sql`coalesce(${tasks.completedAt}, ${tasks.updatedAt}) desc`)
          .limit(2000),

        ctx.db.select({ total: count() }).from(tasks).where(finishedByTarget),

        // Small by nature (one person's open work), so the workload rollup and
        // the "pick this up next" choice are both derived from it below.
        ctx.db
          .select({
            id: tasks.id,
            title: tasks.title,
            projectId: tasks.projectId,
            projectTitle: projects.title,
            priority: tasks.priority,
            dueDate: tasks.dueDate,
            createdAt: tasks.createdAt,
          })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .where(and(inScope, eq(tasks.assignedToId, targetId), ne(tasks.status, "completed")))
          .limit(1000),

        // "Quiet for 9 days" is about the project, not about this person's
        // slice of it, so the last touch is taken over every task in it.
        ctx.db
          .select({ projectId: tasks.projectId, lastTouchedAt: max(tasks.updatedAt) })
          .from(tasks)
          .where(inScope)
          .groupBy(tasks.projectId),
      ]);

      const lastTouched = new Map<number, Date | null>(
        projectTouchRows.map((r) => [r.projectId, r.lastTouchedAt ?? null]),
      );

      const grouped = new Map<number, WorkloadRow>();
      for (const task of openRows) {
        const row = grouped.get(task.projectId) ?? {
          projectId: task.projectId,
          projectTitle: task.projectTitle,
          open: 0,
          lastTouchedAt: lastTouched.get(task.projectId) ?? null,
        };
        row.open += 1;
        grouped.set(task.projectId, row);
      }
      const workload = Array.from(grouped.values()).sort((a, b) => b.open - a.open);

      const nextUp = [...openRows].sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
          dueRank(a.dueDate) - dueRank(b.dueDate) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )[0];

      return {
        ...empty,
        allTimeCompleted: Number(allTimeRows[0]?.total ?? 0),
        entries: entryRows,
        workload,
        nextTask: nextUp
          ? {
              id: nextUp.id,
              title: nextUp.title,
              projectId: nextUp.projectId,
              projectTitle: nextUp.projectTitle,
              priority: nextUp.priority,
              dueDate: nextUp.dueDate,
              /** Other open tasks in the same project, i.e. what it unblocks. */
              waitingBehind:
                (grouped.get(nextUp.projectId)?.open ?? 1) - 1,
            }
          : null,
      };
    }),
});

/** Tasks with no due date sort last rather than first. */
function dueRank(due: Date | null): number {
  return due ? due.getTime() : Number.MAX_SAFE_INTEGER;
}

type LeaderboardPerson = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  completed: number;
  isSelf: boolean;
};

type RecordEntryRow = {
  id: number;
  title: string;
  projectId: number;
  projectTitle: string;
  createdAt: Date;
  finishedAt: Date;
};

type WorkloadRow = {
  projectId: number;
  projectTitle: string;
  open: number;
  lastTouchedAt: Date | null;
};

type NextTaskRow = {
  id: number;
  title: string;
  projectId: number;
  projectTitle: string;
  priority: string;
  dueDate: Date | null;
  waitingBehind: number;
};
