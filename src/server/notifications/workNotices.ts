/**
 * The wording of every task and project notice, in one place.
 *
 * Task and project changes reach the database through two doors: the tRPC
 * routers, and the AI agents (A2 task planner, A6 project manager) that apply a
 * confirmed plan on the user's behalf. Before this module only the routers
 * notified anyone, so a task the agent assigned to you arrived silently — the
 * same change, a different code path, a different outcome. Both doors now call
 * these helpers, so they cannot drift apart in who is told or what they read.
 *
 * Every helper takes the *acting* user. For the agents that is the user the
 * agent works for, which keeps "you don't get notified about your own change"
 * true whether you clicked the button or asked the assistant to.
 *
 * None of these throw: `notify` and `notifyMany` swallow delivery failures, and
 * the lookups here are the same cheap reads the routers already made inline.
 */

import { eq } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { projects, users } from "~/server/db/schema";
import { notify, notifyMany } from "~/server/notifications/dispatch";
import { projectAudience } from "~/server/notifications/audience";

type Db = typeof Database;

type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
type TaskPriority = "low" | "medium" | "high" | "urgent";

const projectLink = (projectId: number) => `/projects?projectId=${projectId}`;

/**
 * How long a non-completion status notice suppresses the next one for the same
 * task. Dragging a card pending → in progress → pending is one thought, not three.
 */
const STATUS_COALESCE_MS = 2 * 60 * 1000;

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "To do",
  in_progress: "In progress",
  completed: "Completed",
  blocked: "Blocked",
};

async function actorName(db: Db, actorId: string): Promise<string> {
  const actor = await db.query.users.findFirst({
    where: eq(users.id, actorId),
    columns: { name: true },
  });
  return actor?.name ?? "Someone";
}

async function projectTitle(db: Db, projectId: number): Promise<string> {
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project?.title ?? "a project";
}

function formatDate(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "no due date";
}

/**
 * Tell a project's members that work was added, and tell an assignee it is theirs.
 *
 * The assignee gets the *assignment* notice and is excluded from the general
 * activity notice, so being given a task is one bell entry rather than two.
 */
export async function notifyTaskCreated(
  db: Db,
  input: {
    actorId: string;
    projectId: number;
    task: { title: string; assignedToId: string | null };
  },
): Promise<void> {
  const { actorId, projectId, task } = input;
  const [name, title] = await Promise.all([
    actorName(db, actorId),
    projectTitle(db, projectId),
  ]);
  const link = projectLink(projectId);

  if (task.assignedToId && task.assignedToId !== actorId) {
    await notify({
      db,
      userId: task.assignedToId,
      actorId,
      category: "taskAssignment",
      type: "task",
      title: "New task assigned to you",
      message: `${name} assigned you "${task.title}" in ${title}.`,
      link,
    });
  }

  const audience = (await projectAudience(db, projectId)).filter(
    (id) => id !== task.assignedToId,
  );

  await notifyMany({
    db,
    userIds: audience,
    actorId,
    category: "projectUpdate",
    type: "project",
    title: "New task added",
    message: `${name} added "${task.title}" to ${title}.`,
    link,
  });
}

/**
 * An existing task changed hands.
 *
 * The new owner is told it is theirs; the previous owner is told it no longer
 * is — otherwise a task silently vanishes from someone's list and they find out
 * by noticing the gap. Callers pass the stored and the requested assignee and
 * this decides whether anything actually changed.
 */
export async function notifyTaskAssignmentChanged(
  db: Db,
  input: {
    actorId: string;
    projectId: number;
    taskTitle: string;
    previousAssigneeId: string | null;
    newAssigneeId: string | null;
  },
): Promise<void> {
  const { actorId, projectId, taskTitle, previousAssigneeId, newAssigneeId } = input;
  if (previousAssigneeId === newAssigneeId) return;

  const [name, title] = await Promise.all([
    actorName(db, actorId),
    projectTitle(db, projectId),
  ]);
  const link = projectLink(projectId);

  if (newAssigneeId) {
    await notify({
      db,
      userId: newAssigneeId,
      actorId,
      category: "taskAssignment",
      type: "task",
      title: "Task assigned to you",
      message: `${name} assigned you "${taskTitle}" in ${title}.`,
      link,
    });
  }

  if (previousAssigneeId) {
    await notify({
      db,
      userId: previousAssigneeId,
      actorId,
      category: "taskAssignment",
      type: "task",
      title: newAssigneeId ? "Task reassigned" : "Task unassigned",
      message: newAssigneeId
        ? `${name} reassigned "${taskTitle}" in ${title} to someone else.`
        : `${name} removed you from "${taskTitle}" in ${title}.`,
      link,
    });
  }
}

/**
 * The due date and/or priority of a task changed.
 *
 * One notice per save, summarising every field that moved, rather than one per
 * field: a rescheduled-and-reprioritised task is one piece of news.
 */
export async function notifyTaskDetailsChanged(
  db: Db,
  input: {
    actorId: string;
    projectId: number;
    taskTitle: string;
    assigneeId: string | null;
    dueDate?: { from: Date | null; to: Date | null };
    priority?: { from: TaskPriority; to: TaskPriority };
  },
): Promise<void> {
  const { actorId, projectId, taskTitle, assigneeId } = input;
  if (!assigneeId || assigneeId === actorId) return;

  const changes: string[] = [];
  if (input.dueDate && input.dueDate.from?.getTime() !== input.dueDate.to?.getTime()) {
    changes.push(`due date ${formatDate(input.dueDate.from)} → ${formatDate(input.dueDate.to)}`);
  }
  if (input.priority && input.priority.from !== input.priority.to) {
    changes.push(`priority ${input.priority.from} → ${input.priority.to}`);
  }
  if (changes.length === 0) return;

  const [name, title] = await Promise.all([
    actorName(db, actorId),
    projectTitle(db, projectId),
  ]);

  await notify({
    db,
    userId: assigneeId,
    actorId,
    category: "taskAssignment",
    type: "task",
    title: "Task updated",
    message: `${name} changed "${taskTitle}" in ${title}: ${changes.join(", ")}.`,
    link: projectLink(projectId),
  });
}

/**
 * A task moved between statuses. Goes to its creator and its assignee.
 *
 * Completion is always delivered — it is the news people wait for. Every other
 * transition coalesces per task for a couple of minutes, so dragging a card back
 * and forth does not ring the bell each time.
 */
export async function notifyTaskStatusChanged(
  db: Db,
  input: {
    actorId: string;
    projectId: number;
    task: {
      id: number;
      title: string;
      createdById: string | null;
      assignedToId: string | null;
    };
    oldStatus: TaskStatus;
    newStatus: TaskStatus;
  },
): Promise<void> {
  const { actorId, projectId, task, oldStatus, newStatus } = input;
  if (oldStatus === newStatus) return;

  const recipients = [...new Set([task.createdById, task.assignedToId])].filter(
    (id): id is string => !!id && id !== actorId,
  );
  if (recipients.length === 0) return;

  const [name, title] = await Promise.all([
    actorName(db, actorId),
    projectTitle(db, projectId),
  ]);

  const completed = newStatus === "completed";
  const reopened = oldStatus === "completed";
  const noticeTitle = completed
    ? "Task completed"
    : reopened
      ? "Task reopened"
      : "Task status changed";
  const message = completed
    ? `${name} completed "${task.title}" in ${title}.`
    : `${name} moved "${task.title}" in ${title} to ${STATUS_LABEL[newStatus]}.`;

  for (const userId of recipients) {
    await notify({
      db,
      userId,
      actorId,
      category: "projectUpdate",
      type: "task",
      title: noticeTitle,
      message,
      // Task-specific so coalescing only folds notices about this one task.
      link: `${projectLink(projectId)}&taskId=${task.id}`,
      coalesceWindowMs: completed || reopened ? undefined : STATUS_COALESCE_MS,
    });
  }
}

/**
 * A task was deleted. The assignee is the one whose list just shrank.
 *
 * Callers read the task before deleting it — after the delete there is nothing
 * left to name.
 */
export async function notifyTaskDeleted(
  db: Db,
  input: {
    actorId: string;
    projectId: number;
    task: { title: string; assignedToId: string | null };
  },
): Promise<void> {
  const { actorId, projectId, task } = input;
  if (!task.assignedToId || task.assignedToId === actorId) return;

  const [name, title] = await Promise.all([
    actorName(db, actorId),
    projectTitle(db, projectId),
  ]);

  await notify({
    db,
    userId: task.assignedToId,
    actorId,
    category: "projectUpdate",
    type: "task",
    title: "Task deleted",
    message: `${name} deleted "${task.title}" from ${title}.`,
    link: projectLink(projectId),
  });
}

/** A collaborator was taken off a project. They can no longer open it, hence `/projects`. */
export async function notifyCollaboratorRemoved(
  db: Db,
  input: { actorId: string; userId: string; projectTitle: string },
): Promise<void> {
  const name = await actorName(db, input.actorId);
  await notify({
    db,
    userId: input.userId,
    actorId: input.actorId,
    category: "workspace",
    type: "project",
    title: "Removed from project",
    message: `${name} removed you from "${input.projectTitle}".`,
    link: "/projects",
  });
}

/** A collaborator's access to a project changed between view and edit. */
export async function notifyCollaboratorPermissionChanged(
  db: Db,
  input: {
    actorId: string;
    userId: string;
    projectId: number;
    projectTitle: string;
    permission: "read" | "write";
  },
): Promise<void> {
  const name = await actorName(db, input.actorId);
  const verb = input.permission === "write" ? "edit" : "view";
  await notify({
    db,
    userId: input.userId,
    actorId: input.actorId,
    category: "workspace",
    type: "project",
    title: "Project access changed",
    message: `${name} changed your access to "${input.projectTitle}": you can now ${verb} it.`,
    link: projectLink(input.projectId),
  });
}

/**
 * A project was deleted, archived or reopened. Goes to its whole audience.
 *
 * For a delete the caller must read the audience first and pass it in: once the
 * project row is gone, its collaborator rows have cascaded with it.
 */
export async function notifyProjectLifecycle(
  db: Db,
  input: {
    actorId: string;
    projectId: number;
    projectTitle: string;
    change: "deleted" | "archived" | "reopened";
    /** Required for `deleted`; read from the project otherwise. */
    audience?: string[];
  },
): Promise<void> {
  const { actorId, projectId, change } = input;
  const audience = input.audience ?? (await projectAudience(db, projectId));
  if (audience.every((id) => id === actorId)) return;

  const name = await actorName(db, actorId);
  const copy = {
    deleted: { title: "Project deleted", link: "/projects" },
    archived: { title: "Project archived", link: projectLink(projectId) },
    reopened: { title: "Project reopened", link: projectLink(projectId) },
  }[change];

  await notifyMany({
    db,
    userIds: audience,
    actorId,
    category: "projectUpdate",
    type: "project",
    title: copy.title,
    message: `${name} ${change} "${input.projectTitle}".`,
    link: copy.link,
  });
}
