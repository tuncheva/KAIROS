/**
 * A-2 — the tools that widen what A1 can see.
 *
 * The original eight tools could only walk *down* a project: list projects, list
 * that project's tasks, open one task. Everything below either crosses projects
 * (`listMyWork`, `getWorkloadByAssignee`, `getCalendarRange`) or reaches a record
 * type A1 had no path to at all (comments, activity, members, collaborators,
 * notes, RSVPs).
 *
 * One design rule carried over from `getProjectDetail`, which is the reason
 * progress questions already work: **a tool returns the computed answer, not rows
 * for the model to count.** `getProjectHealth` returns a completion rate and an
 * overdue cluster; it does not return four hundred tasks and hope. Counting is
 * the thing language models are worst at and Postgres is best at.
 *
 * Authorization is per-tool and fails closed. Every id here arrives from model
 * output, so it is treated exactly like user input.
 */

import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { assertProjectAccess } from "~/server/api/authz";
import {
  events,
  eventRsvps,
  organizationMembers,
  projectCollaborators,
  projects,
  stickyNotes,
  taskActivityLog,
  taskComments,
  tasks,
  users,
} from "~/server/db/schema";

import {
  loadVisibleScope,
  requireUser,
  visibleProjectsWhere,
} from "./scope";
import type { A1Tool } from "./types";

/** Projects the caller may read, as ids plus a title lookup. */
async function visibleProjectMap(
  ctx: TRPCContext,
  userId: string,
): Promise<{ ids: number[]; titleById: Map<number, string> }> {
  const scope = await loadVisibleScope(ctx, userId);
  const rows = await ctx.db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(visibleProjectsWhere(scope));
  return {
    ids: rows.map((r) => r.id),
    titleById: new Map(rows.map((r) => [r.id, r.title])),
  };
}

// ---------------------------------------------------------------------------
// listMyWork — cross-project, assigned to the caller
// ---------------------------------------------------------------------------

type ListMyWorkInput = { withinDays?: number; limit?: number };

export interface MyWorkItem {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  projectId: number;
  projectTitle: string;
  overdue: boolean;
}

export const listMyWorkTool: A1Tool<"listMyWork", ListMyWorkInput, MyWorkItem[]> = {
  name: "listMyWork",
  inputSchema: z
    .object({
      withinDays: z.number().int().min(1).max(90).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  outputSchema: z.custom<MyWorkItem[]>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);
    const { ids, titleById } = await visibleProjectMap(ctx, userId);
    if (!ids.length) return [];

    const now = new Date();
    const clauses = [
      inArray(tasks.projectId, ids),
      eq(tasks.assignedToId, userId),
    ];

    if (input.withinDays !== undefined) {
      const horizon = new Date(
        now.getTime() + input.withinDays * 24 * 60 * 60 * 1000,
      );
      clauses.push(lte(tasks.dueDate, horizon));
    }

    const rows = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .where(and(...clauses))
      // Nulls last: an undated task is not more urgent than a dated one.
      .orderBy(sql`${tasks.dueDate} ASC NULLS LAST`, desc(tasks.priority))
      .limit(input.limit ?? 25);

    return rows.map((r) => ({
      ...r,
      projectTitle: titleById.get(r.projectId) ?? "Unknown project",
      overdue: Boolean(
        r.dueDate && r.dueDate < now && r.status !== "completed",
      ),
    }));
  },
};

// ---------------------------------------------------------------------------
// getWorkloadByAssignee — who is carrying what
// ---------------------------------------------------------------------------

type WorkloadInput = { projectId?: number };

export interface WorkloadRow {
  userId: string | null;
  name: string;
  open: number;
  inProgress: number;
  overdue: number;
  completed: number;
}

export const getWorkloadByAssigneeTool: A1Tool<
  "getWorkloadByAssignee",
  WorkloadInput,
  WorkloadRow[]
> = {
  name: "getWorkloadByAssignee",
  inputSchema: z.object({ projectId: z.number().optional() }).strict(),
  outputSchema: z.custom<WorkloadRow[]>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    let scopeIds: number[];
    if (input.projectId !== undefined) {
      await assertProjectAccess(ctx, input.projectId, "read");
      scopeIds = [input.projectId];
    } else {
      scopeIds = (await visibleProjectMap(ctx, userId)).ids;
    }
    if (!scopeIds.length) return [];

    const rows = await ctx.db
      .select({
        assignedToId: tasks.assignedToId,
        name: users.name,
        status: tasks.status,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(inArray(tasks.projectId, scopeIds));

    const now = new Date();
    const byAssignee = new Map<string, WorkloadRow>();

    for (const row of rows) {
      const key = row.assignedToId ?? "__unassigned__";
      let entry = byAssignee.get(key);
      if (!entry) {
        entry = {
          userId: row.assignedToId,
          name: row.assignedToId ? (row.name ?? "Unnamed") : "Unassigned",
          open: 0,
          inProgress: 0,
          overdue: 0,
          completed: 0,
        };
        byAssignee.set(key, entry);
      }

      if (row.status === "completed") entry.completed += 1;
      else {
        entry.open += 1;
        if (row.status === "in_progress") entry.inProgress += 1;
        if (row.dueDate && row.dueDate < now) entry.overdue += 1;
      }
    }

    // Heaviest load first — that is what "who is overloaded" is asking for.
    return [...byAssignee.values()].sort((a, b) => b.open - a.open);
  },
};

// ---------------------------------------------------------------------------
// listTaskComments / getTaskActivity
// ---------------------------------------------------------------------------

/** A task is readable exactly when its project is. */
async function assertTaskReadable(
  ctx: TRPCContext,
  taskId: number,
): Promise<void> {
  const [task] = await ctx.db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  await assertProjectAccess(ctx, task.projectId, "read");
}

type TaskScopedInput = { taskId: number; limit?: number };

const TaskScopedInputSchema = z
  .object({
    taskId: z.number().int().positive(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export interface TaskCommentRow {
  id: number;
  content: string;
  authorName: string;
  createdAt: Date;
}

export const listTaskCommentsTool: A1Tool<
  "listTaskComments",
  TaskScopedInput,
  TaskCommentRow[]
> = {
  name: "listTaskComments",
  inputSchema: TaskScopedInputSchema,
  outputSchema: z.custom<TaskCommentRow[]>(),

  async execute(ctx, input) {
    await assertTaskReadable(ctx, input.taskId);

    const rows = await ctx.db
      .select({
        id: taskComments.id,
        content: taskComments.content,
        authorName: users.name,
        createdAt: taskComments.createdAt,
      })
      .from(taskComments)
      .leftJoin(users, eq(taskComments.createdById, users.id))
      .where(eq(taskComments.taskId, input.taskId))
      .orderBy(desc(taskComments.createdAt))
      .limit(input.limit ?? 20);

    return rows.map((r) => ({ ...r, authorName: r.authorName ?? "Unknown" }));
  },
};

export interface TaskActivityRow {
  action: string;
  oldValue: string | null;
  newValue: string | null;
  actorName: string;
  createdAt: Date;
}

export const getTaskActivityTool: A1Tool<
  "getTaskActivity",
  TaskScopedInput,
  TaskActivityRow[]
> = {
  name: "getTaskActivity",
  inputSchema: TaskScopedInputSchema,
  outputSchema: z.custom<TaskActivityRow[]>(),

  async execute(ctx, input) {
    await assertTaskReadable(ctx, input.taskId);

    const rows = await ctx.db
      .select({
        action: taskActivityLog.action,
        oldValue: taskActivityLog.oldValue,
        newValue: taskActivityLog.newValue,
        actorName: users.name,
        createdAt: taskActivityLog.createdAt,
      })
      .from(taskActivityLog)
      .leftJoin(users, eq(taskActivityLog.userId, users.id))
      .where(eq(taskActivityLog.taskId, input.taskId))
      .orderBy(desc(taskActivityLog.createdAt))
      .limit(input.limit ?? 20);

    return rows.map((r) => ({ ...r, actorName: r.actorName ?? "Unknown" }));
  },
};

// ---------------------------------------------------------------------------
// listOrgMembers / listProjectCollaborators
// ---------------------------------------------------------------------------

export interface OrgMemberRow {
  userId: string;
  name: string;
  role: string;
  joinedAt: Date;
}

export const listOrgMembersTool: A1Tool<
  "listOrgMembers",
  { organizationId: number },
  OrgMemberRow[]
> = {
  name: "listOrgMembers",
  inputSchema: z.object({ organizationId: z.number().int().positive() }).strict(),
  outputSchema: z.custom<OrgMemberRow[]>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    // Only a member may enumerate the membership. Without this, any signed-in
    // user could walk the org id space through the agent.
    const [self] = await ctx.db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!self) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of that organization.",
      });
    }

    const rows = await ctx.db
      .select({
        userId: organizationMembers.userId,
        name: users.name,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .leftJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, input.organizationId))
      .orderBy(asc(organizationMembers.joinedAt))
      .limit(100);

    return rows.map((r) => ({ ...r, name: r.name ?? "Unnamed" }));
  },
};

export interface CollaboratorRow {
  userId: string;
  name: string;
  permission: string;
  joinedAt: Date;
}

export const listProjectCollaboratorsTool: A1Tool<
  "listProjectCollaborators",
  { projectId: number },
  CollaboratorRow[]
> = {
  name: "listProjectCollaborators",
  inputSchema: z.object({ projectId: z.number().int().positive() }).strict(),
  outputSchema: z.custom<CollaboratorRow[]>(),

  async execute(ctx, input) {
    await assertProjectAccess(ctx, input.projectId, "read");

    const rows = await ctx.db
      .select({
        userId: projectCollaborators.collaboratorId,
        name: users.name,
        permission: projectCollaborators.permission,
        joinedAt: projectCollaborators.joinedAt,
      })
      .from(projectCollaborators)
      .leftJoin(users, eq(projectCollaborators.collaboratorId, users.id))
      .where(eq(projectCollaborators.projectId, input.projectId))
      .limit(50);

    return rows.map((r) => ({ ...r, name: r.name ?? "Unnamed" }));
  },
};

// ---------------------------------------------------------------------------
// getCalendarRange — everything landing in a window
// ---------------------------------------------------------------------------

type CalendarRangeInput = { from: string; to: string };

export interface CalendarEntry {
  kind: "task" | "note" | "event";
  id: number;
  title: string;
  at: Date;
  projectTitle?: string;
  status?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

export const getCalendarRangeTool: A1Tool<
  "getCalendarRange",
  CalendarRangeInput,
  CalendarEntry[]
> = {
  name: "getCalendarRange",
  inputSchema: z
    .object({
      from: z.string().regex(ISO_DATE),
      to: z.string().regex(ISO_DATE),
    })
    .strict(),
  outputSchema: z.custom<CalendarEntry[]>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);
    const from = new Date(input.from);
    const to = new Date(input.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date range" });
    }
    if (to < from) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "`to` is before `from`" });
    }

    const { ids, titleById } = await visibleProjectMap(ctx, userId);
    const entries: CalendarEntry[] = [];

    if (ids.length) {
      const taskRows = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          dueDate: tasks.dueDate,
          status: tasks.status,
          projectId: tasks.projectId,
        })
        .from(tasks)
        .where(
          and(
            inArray(tasks.projectId, ids),
            isNotNull(tasks.dueDate),
            gte(tasks.dueDate, from),
            lte(tasks.dueDate, to),
          ),
        )
        .orderBy(asc(tasks.dueDate))
        .limit(100);

      entries.push(
        ...taskRows.map((r) => ({
          kind: "task" as const,
          id: r.id,
          title: r.title,
          at: r.dueDate!,
          status: r.status,
          projectTitle: titleById.get(r.projectId),
        })),
      );
    }

    // Notes scheduled onto the calendar. Title only — never content, so a
    // locked note contributes nothing beyond the fact that it is scheduled.
    const noteRows = await ctx.db
      .select({
        id: stickyNotes.id,
        title: stickyNotes.title,
        calendarDate: stickyNotes.calendarDate,
      })
      .from(stickyNotes)
      .where(
        and(
          eq(stickyNotes.createdById, userId),
          isNotNull(stickyNotes.calendarDate),
          gte(stickyNotes.calendarDate, from),
          lte(stickyNotes.calendarDate, to),
        ),
      )
      .orderBy(asc(stickyNotes.calendarDate))
      .limit(50);

    entries.push(
      ...noteRows.map((r) => ({
        kind: "note" as const,
        id: r.id,
        title: r.title ?? "Untitled note",
        at: r.calendarDate!,
      })),
    );

    const eventRows = await ctx.db
      .select({ id: events.id, title: events.title, eventDate: events.eventDate })
      .from(events)
      .where(and(gte(events.eventDate, from), lte(events.eventDate, to)))
      .orderBy(asc(events.eventDate))
      .limit(50);

    entries.push(
      ...eventRows.map((r) => ({
        kind: "event" as const,
        id: r.id,
        title: r.title,
        at: r.eventDate,
      })),
    );

    return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  },
};

// ---------------------------------------------------------------------------
// listNotesMetadata — shape only, never locked content
// ---------------------------------------------------------------------------

export interface NoteMetaRow {
  id: number;
  title: string;
  locked: boolean;
  preview: string | null;
  updatedAt: Date;
}

export const listNotesMetadataTool: A1Tool<
  "listNotesMetadata",
  { limit?: number },
  NoteMetaRow[]
> = {
  name: "listNotesMetadata",
  inputSchema: z
    .object({ limit: z.number().int().min(1).max(50).optional() })
    .strict(),
  outputSchema: z.custom<NoteMetaRow[]>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    const rows = await ctx.db
      .select({
        id: stickyNotes.id,
        title: stickyNotes.title,
        content: stickyNotes.content,
        passwordHash: stickyNotes.passwordHash,
        updatedAt: stickyNotes.updatedAt,
      })
      .from(stickyNotes)
      .where(eq(stickyNotes.createdById, userId))
      .orderBy(desc(stickyNotes.updatedAt))
      .limit(input.limit ?? 25);

    return rows.map((r) => {
      const locked = r.passwordHash !== null;
      return {
        id: r.id,
        title: r.title ?? "Untitled note",
        locked,
        // The whole point of the lock: the model learns the note exists and
        // nothing about what it says.
        preview: locked ? null : r.content.replace(/\s+/g, " ").slice(0, 140),
        updatedAt: r.updatedAt,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// listEventRsvps — owner only
// ---------------------------------------------------------------------------

export interface RsvpRow {
  userId: string;
  name: string;
  status: string;
}

export const listEventRsvpsTool: A1Tool<
  "listEventRsvps",
  { eventId: number },
  { going: number; maybe: number; notGoing: number; responses: RsvpRow[] }
> = {
  name: "listEventRsvps",
  inputSchema: z.object({ eventId: z.number().int().positive() }).strict(),
  outputSchema: z.custom<{
    going: number;
    maybe: number;
    notGoing: number;
    responses: RsvpRow[];
  }>(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    const [event] = await ctx.db
      .select({ createdById: events.createdById })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1);

    if (!event) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
    }

    // The feed is public; the guest list is not. Only the organizer sees who
    // replied and how.
    if (event.createdById !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the event organizer can see the RSVP list.",
      });
    }

    const rows = await ctx.db
      .select({
        userId: eventRsvps.userId,
        name: users.name,
        status: eventRsvps.status,
      })
      .from(eventRsvps)
      .leftJoin(users, eq(eventRsvps.userId, users.id))
      .where(eq(eventRsvps.eventId, input.eventId))
      .limit(200);

    const responses = rows.map((r) => ({ ...r, name: r.name ?? "Unnamed" }));

    return {
      going: responses.filter((r) => r.status === "going").length,
      maybe: responses.filter((r) => r.status === "maybe").length,
      notGoing: responses.filter((r) => r.status === "not_going").length,
      responses,
    };
  },
};

// ---------------------------------------------------------------------------
// getProjectHealth — the computed answer, not the rows
// ---------------------------------------------------------------------------

export interface ProjectHealth {
  projectId: number;
  title: string;
  completionRate: number;
  totals: {
    total: number;
    completed: number;
    open: number;
    blocked: number;
    overdue: number;
    unassigned: number;
    noDueDate: number;
  };
  /** Completed in the last 14 days — the closest thing to velocity available. */
  completedLast14Days: number;
  /** Nothing finished recently while open work remains. */
  stalled: boolean;
  risks: string[];
}

export const getProjectHealthTool: A1Tool<
  "getProjectHealth",
  { projectId: number },
  ProjectHealth
> = {
  name: "getProjectHealth",
  inputSchema: z.object({ projectId: z.number().int().positive() }).strict(),
  outputSchema: z.custom<ProjectHealth>(),

  async execute(ctx, input) {
    await assertProjectAccess(ctx, input.projectId, "read");

    const [project] = await ctx.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    const rows = await ctx.db
      .select({
        status: tasks.status,
        dueDate: tasks.dueDate,
        assignedToId: tasks.assignedToId,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(eq(tasks.projectId, input.projectId));

    const now = new Date();
    const fortnightAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const total = rows.length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const open = total - completed;
    const blocked = rows.filter((r) => r.status === "blocked").length;
    const overdue = rows.filter(
      (r) => r.dueDate && r.dueDate < now && r.status !== "completed",
    ).length;
    const unassigned = rows.filter(
      (r) => !r.assignedToId && r.status !== "completed",
    ).length;
    const noDueDate = rows.filter(
      (r) => !r.dueDate && r.status !== "completed",
    ).length;
    const completedLast14Days = rows.filter(
      (r) => r.completedAt && r.completedAt >= fortnightAgo,
    ).length;

    const stalled = open > 0 && completedLast14Days === 0;

    // Phrased as findings rather than numbers, because this is what the model
    // will paraphrase — and a sentence survives paraphrase better than a ratio.
    const risks: string[] = [];
    if (overdue > 0) risks.push(`${overdue} task(s) are past their due date.`);
    if (blocked > 0) risks.push(`${blocked} task(s) are blocked.`);
    if (unassigned > 0) risks.push(`${unassigned} open task(s) have no assignee.`);
    if (noDueDate > 0) risks.push(`${noDueDate} open task(s) have no due date.`);
    if (stalled) risks.push("Nothing has been completed in the last 14 days.");
    if (total === 0) risks.push("The project has no tasks yet.");

    return {
      projectId: project.id,
      title: project.title,
      completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
      totals: { total, completed, open, blocked, overdue, unassigned, noDueDate },
      completedLast14Days,
      stalled,
      risks,
    };
  },
};
