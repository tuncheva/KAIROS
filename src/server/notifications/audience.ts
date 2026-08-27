/**
 * Who is "on" a project, and who has "subscribed to" an event.
 *
 * These two questions had no answer anywhere in the codebase, which is the real
 * reason project activity and event changes notified nobody: there was no way to
 * name the audience, so the features that needed one were written to notify a
 * single hard-coded person instead (the project owner, the event owner) or
 * skipped entirely.
 */

import { and, eq, ne } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { eventRsvps, projectCollaborators, projects } from "~/server/db/schema";

type Db = typeof Database;

/**
 * Everyone with a stake in a project: its owner plus every collaborator,
 * regardless of read/write permission.
 *
 * View-only collaborators are included deliberately. Permission governs what you
 * may change, not what you may be told — a stakeholder who can only read the
 * plan still wants to know the plan moved.
 */
export async function projectAudience(db: Db, projectId: number): Promise<string[]> {
  const [owner] = await db
    .select({ createdById: projects.createdById })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const collaborators = await db
    .select({ collaboratorId: projectCollaborators.collaboratorId })
    .from(projectCollaborators)
    .where(eq(projectCollaborators.projectId, projectId));

  const ids = collaborators.map((c) => c.collaboratorId);
  if (owner) ids.push(owner.createdById);

  return [...new Set(ids)];
}

/**
 * Everyone subscribed to an event.
 *
 * "Subscribed" is any RSVP except `not_going`. An explicit decline is a statement
 * that this event is no longer the user's concern, so a change to it is not news
 * — treating every RSVP row as a subscription would keep notifying people
 * precisely because they said no. `maybe` still counts: someone undecided is the
 * person most affected by a change of date.
 */
export async function eventSubscribers(db: Db, eventId: number): Promise<string[]> {
  const rows = await db
    .select({ userId: eventRsvps.userId })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), ne(eventRsvps.status, "not_going")));

  return [...new Set(rows.map((r) => r.userId))];
}
