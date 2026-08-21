/**
 * A-1 — `searchWorkspace`: the retrieval tool.
 *
 * Before this existed, A1 could only reach a record by walking down from a
 * project id: `listProjects` → `listTasks` → `getTaskDetail`. Any question that
 * did not start from a project the user could name by title was unanswerable by
 * construction — "where did we discuss the payment flow?" had no path at all.
 *
 * Implementation notes:
 *
 * - **Postgres full-text, `simple` configuration.** Not `english`: KAIROS ships
 *   five locales and notes are routinely written in Bulgarian. English stemming
 *   and stopword removal would quietly damage every other language, and `simple`
 *   costs only stemming we cannot correctly do across five languages anyway.
 * - **FTS `OR` trigram-free `ILIKE`.** FTS matches whole lexemes, so a user
 *   typing "paym" finds nothing. The `ILIKE` arm covers prefixes and substrings;
 *   the FTS arm covers word order and multi-word queries.
 * - **Authorization is a filter, not a check.** Every branch is constrained to
 *   the caller's visible project set (or their own notes), so an unauthorized
 *   row cannot appear in the result the model then quotes back verbatim.
 * - **Locked notes never match.** `password_hash IS NOT NULL` is excluded in
 *   SQL, which is the fourth of the existing three layers, and the only one that
 *   applies before the content is ever loaded into memory.
 *
 * The GIN indexes that make this fast are in `scripts/sql/search-indexes.sql`.
 * The query is correct without them — it degrades to a sequential scan, which at
 * this application's row counts is milliseconds.
 */

import "server-only";

import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  events,
  noteShares,
  projects,
  stickyNotes,
  taskComments,
  tasks,
} from "~/server/db/schema";

import { loadVisibleScope, requireUser, visibleProjectsWhere } from "./scope";
import type { A1Tool } from "./types";

const SEARCHABLE_KINDS = [
  "task",
  "project",
  "note",
  "event",
  "comment",
] as const;

export type SearchKind = (typeof SEARCHABLE_KINDS)[number];

export interface SearchHit {
  kind: SearchKind;
  id: number;
  title: string;
  /** A window of the matching text, not the whole record. */
  snippet: string;
  projectId?: number;
  projectTitle?: string;
  status?: string;
  updatedAt: Date | null;
}

type SearchWorkspaceInput = {
  query: string;
  kinds?: SearchKind[];
  limit?: number;
};

const SearchWorkspaceInputSchema = z
  .object({
    query: z.string().min(2).max(200),
    kinds: z.array(z.enum(SEARCHABLE_KINDS)).min(1).max(5).optional(),
    limit: z.number().int().min(1).max(40).optional(),
  })
  .strict();

/**
 * Match one or more columns against the query, by lexeme or by substring.
 *
 * `plainto_tsquery` handles the multi-word case ("payment flow" becomes an AND
 * of both lexemes); the `ILIKE` arm rescues the prefix case that full-text
 * search structurally cannot serve.
 */
function matches(columns: string[], query: string) {
  const document = columns
    .map((c) => `coalesce(${c}, '')`)
    .join(" || ' ' || ");

  return sql`(
    to_tsvector('simple', ${sql.raw(document)}) @@ plainto_tsquery('simple', ${query})
    OR ${sql.raw(document)} ILIKE ${"%" + query + "%"}
  )`;
}

/** A window of text around the first match, so one long note cannot flood the context. */
function snippet(text: string | null, query: string, width = 180): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;

  const at = flat.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0] ?? "");
  if (at < 0) return `${flat.slice(0, width)}…`;

  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

export const searchWorkspaceTool: A1Tool<
  "searchWorkspace",
  SearchWorkspaceInput,
  SearchHit[]
> = {
  name: "searchWorkspace",
  inputSchema: SearchWorkspaceInputSchema,
  outputSchema: z.custom<SearchHit[]>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);
    const limit = input.limit ?? 15;
    const kinds = new Set<SearchKind>(input.kinds ?? [...SEARCHABLE_KINDS]);
    const q = input.query.trim();

    const scope = await loadVisibleScope(ctx, userId);
    const visibleProjects = await ctx.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(visibleProjectsWhere(scope));

    const projectTitleById = new Map(
      visibleProjects.map((p) => [p.id, p.title]),
    );
    const projectIds = visibleProjects.map((p) => p.id);

    // Per-kind budget. A workspace with 400 matching tasks should still leave
    // room for the one matching note, which is often the answer.
    const perKind = Math.max(3, Math.ceil(limit / kinds.size));
    const hits: SearchHit[] = [];

    // ---- projects
    if (kinds.has("project") && projectIds.length) {
      const rows = await ctx.db
        .select({
          id: projects.id,
          title: projects.title,
          description: projects.description,
          status: projects.status,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(
          and(
            visibleProjectsWhere(scope),
            matches(["projects.title", "projects.description"], q),
          ),
        )
        .orderBy(desc(projects.updatedAt))
        .limit(perKind);

      hits.push(
        ...rows.map((r) => ({
          kind: "project" as const,
          id: r.id,
          title: r.title,
          snippet: snippet(r.description, q),
          status: r.status,
          updatedAt: r.updatedAt,
        })),
      );
    }

    // ---- tasks
    if (kinds.has("task") && projectIds.length) {
      const rows = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          projectId: tasks.projectId,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(
          and(
            inArray(tasks.projectId, projectIds),
            matches(["tasks.title", "tasks.description"], q),
          ),
        )
        .orderBy(desc(tasks.updatedAt))
        .limit(perKind);

      hits.push(
        ...rows.map((r) => ({
          kind: "task" as const,
          id: r.id,
          title: r.title,
          snippet: snippet(r.description, q),
          status: r.status,
          projectId: r.projectId,
          projectTitle: projectTitleById.get(r.projectId),
          updatedAt: r.updatedAt,
        })),
      );
    }

    // ---- task comments
    if (kinds.has("comment") && projectIds.length) {
      const rows = await ctx.db
        .select({
          id: taskComments.id,
          content: taskComments.content,
          taskId: taskComments.taskId,
          taskTitle: tasks.title,
          projectId: tasks.projectId,
          createdAt: taskComments.createdAt,
        })
        .from(taskComments)
        .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
        .where(
          and(
            inArray(tasks.projectId, projectIds),
            matches(["task_comments.content"], q),
          ),
        )
        .orderBy(desc(taskComments.createdAt))
        .limit(perKind);

      hits.push(
        ...rows.map((r) => ({
          kind: "comment" as const,
          id: r.id,
          title: `Comment on “${r.taskTitle}”`,
          snippet: snippet(r.content, q),
          projectId: r.projectId,
          projectTitle: projectTitleById.get(r.projectId),
          updatedAt: r.createdAt,
        })),
      );
    }

    // ---- notes (own, or shared with the caller; never locked)
    if (kinds.has("note")) {
      const sharedWithMe = await ctx.db
        .select({ noteId: noteShares.noteId })
        .from(noteShares)
        .where(eq(noteShares.sharedWithId, userId));
      const sharedIds = sharedWithMe.map((s) => s.noteId);

      const reachable = or(
        eq(stickyNotes.createdById, userId),
        ...(sharedIds.length ? [inArray(stickyNotes.id, sharedIds)] : []),
      )!;

      const rows = await ctx.db
        .select({
          id: stickyNotes.id,
          title: stickyNotes.title,
          content: stickyNotes.content,
          updatedAt: stickyNotes.updatedAt,
        })
        .from(stickyNotes)
        .where(
          and(
            reachable,
            // The lock is enforced in SQL so locked content is never loaded at
            // all — not filtered out after the fact.
            isNull(stickyNotes.passwordHash),
            matches(["sticky_notes.title", "sticky_notes.content"], q),
          ),
        )
        .orderBy(desc(stickyNotes.updatedAt))
        .limit(perKind);

      hits.push(
        ...rows.map((r) => ({
          kind: "note" as const,
          id: r.id,
          title: r.title ?? "Untitled note",
          snippet: snippet(r.content, q),
          updatedAt: r.updatedAt,
        })),
      );
    }

    // ---- events (the feed is public to signed-in users, matching listEventsPublic)
    if (kinds.has("event")) {
      const rows = await ctx.db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          eventDate: events.eventDate,
        })
        .from(events)
        .where(matches(["event.title", "event.description"], q))
        .orderBy(desc(events.eventDate))
        .limit(perKind);

      hits.push(
        ...rows.map((r) => ({
          kind: "event" as const,
          id: r.id,
          title: r.title,
          snippet: snippet(r.description, q),
          updatedAt: r.eventDate,
        })),
      );
    }

    // Most recently touched first across all kinds — recency is the best
    // relevance proxy available without a ranked index.
    return hits
      .sort(
        (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
      )
      .slice(0, limit);
  },
};
