/**
 * Reading everything a user is entitled to take with them.
 *
 * Scope is the entire content of this module. An export is the single request
 * that touches the widest set of rows, so "which rows" is the only question that
 * matters here — and it must be answered with the same helpers the rest of the
 * agent layer uses, not with a bespoke query that happens to look right.
 *
 * Two boundaries are enforced:
 *
 * - **Projects the user can see**, via `visibleProjectsWhere` — the same predicate
 *   the assistant's own reads go through. An export must not become the one place
 *   where org scoping is re-implemented slightly differently.
 * - **Notes the user owns.** Notes shared *with* someone are deliberately not
 *   included: a share grants reading inside the product, not the right to take a
 *   copy of someone else's note away in a file.
 *
 * Locked note content is withheld here rather than in the formatter, so no
 * caller can accidentally get it by choosing a different output format.
 */

import "server-only";

import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import {
  eventRsvps,
  events,
  projects,
  stickyNotes,
  tasks,
  users,
} from "~/server/db/schema";
import {
  loadVisibleScope,
  visibleProjectsWhere,
} from "~/server/llm/tools/a1/scope";

import type { ExportBundle } from "./formatters";

/**
 * Hard ceilings per collection.
 *
 * An export is synchronous — it streams a response rather than queueing a job —
 * which is the right shape for the amount of data a single user has. These caps
 * are what keep that true: they bound the response, the memory used to build it,
 * and the time the request holds a connection, without needing a job runner.
 */
const MAX_ROWS = 5_000;
const MAX_NOTES = 1_000;

export async function collectExport(
  ctx: TRPCContext,
  userId: string,
  now = new Date(),
): Promise<ExportBundle> {
  const scope = await loadVisibleScope(ctx, userId);

  const [visible, profile] = await Promise.all([
    ctx.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(visibleProjectsWhere(scope)),
    ctx.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((r) => r[0]),
  ]);

  const titleById = new Map(visible.map((p) => [p.id, p.title]));
  const projectIds = visible.map((p) => p.id);

  const [taskRows, noteRows, eventRows] = await Promise.all([
    projectIds.length
      ? ctx.db
          .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            priority: tasks.priority,
            dueDate: tasks.dueDate,
            completedAt: tasks.completedAt,
            createdAt: tasks.createdAt,
            projectId: tasks.projectId,
            assignedToId: tasks.assignedToId,
          })
          .from(tasks)
          .where(inArray(tasks.projectId, projectIds))
          .orderBy(desc(tasks.createdAt))
          .limit(MAX_ROWS)
      : Promise.resolve([]),

    ctx.db
      .select({
        id: stickyNotes.id,
        title: stickyNotes.title,
        content: stickyNotes.content,
        passwordHash: stickyNotes.passwordHash,
        createdAt: stickyNotes.createdAt,
      })
      .from(stickyNotes)
      .where(eq(stickyNotes.createdById, userId))
      .orderBy(desc(stickyNotes.createdAt))
      .limit(MAX_NOTES),

    // Events the user created or answered, not every event in the product.
    //
    // The daily brief queries `events` unscoped, because "what is on today" is a
    // public noticeboard question. An export is a different question: the ICS
    // file goes into someone's real calendar, and filling it with four hundred
    // events they never engaged with makes the feature actively unpleasant.
    ctx.db
      .selectDistinct({
        id: events.id,
        title: events.title,
        description: events.description,
        eventDate: events.eventDate,
      })
      .from(events)
      .leftJoin(eventRsvps, eq(eventRsvps.eventId, events.id))
      .where(
        and(
          isNotNull(events.eventDate),
          or(
            eq(events.createdById, userId),
            eq(eventRsvps.userId, userId),
          ),
        ),
      )
      .orderBy(desc(events.eventDate))
      .limit(MAX_ROWS),
  ]);

  // One lookup for every assignee mentioned, rather than a join that would
  // duplicate task rows, and rather than N queries.
  const assigneeIds = [
    ...new Set(taskRows.map((t) => t.assignedToId).filter((id): id is string => !!id)),
  ];
  const assigneeNames = assigneeIds.length
    ? new Map(
        (
          await ctx.db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, assigneeIds))
        ).map((u) => [u.id, u.name ?? u.email]),
      )
    : new Map<string, string | null>();

  return {
    tasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      projectTitle: titleById.get(t.projectId) ?? "",
      assignee: t.assignedToId
        ? (assigneeNames.get(t.assignedToId) ?? null)
        : null,
    })),
    notes: noteRows.map((n) => {
      const locked = Boolean(n.passwordHash);
      return {
        id: n.id,
        title: n.title,
        // Withheld at the source. A locked note's content leaving through an
        // export would make the lock decorative.
        content: locked ? null : n.content,
        locked,
        createdAt: n.createdAt,
      };
    }),
    events: eventRows,
    exportedAt: now,
    userName: profile?.name ?? null,
  };
}
