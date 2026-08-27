/**
 * Who may see whose profile.
 *
 * One module rather than a check repeated in each procedure, because there are
 * four inputs (the master switch, the chosen audience, the org overlap and the
 * shared-context overlap) and getting any of them wrong leaks a bio to a
 * stranger. Every profile procedure calls `resolveProfileAccess` first and
 * branches on the level it returns.
 *
 * Three levels, not two:
 *
 *   full     — the whole drawer: bio, shared context, activity, follow graph.
 *   minimal  — name and avatar only. This is not a privacy hole: the viewer is
 *              already looking at that name and avatar in a member list or on
 *              an event card, which is what made them tap. Returning `hidden`
 *              here would render an error where a card is expected, and would
 *              tell the viewer *that* someone is hiding, which is more than
 *              hiding was meant to disclose.
 *   hidden   — the target does not exist, or has been deleted. Nothing renders.
 *
 * Viewing yourself is always `full`, whatever your settings say — the settings
 * screen previews the drawer through the same procedures.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import {
  conversationParticipants,
  eventRsvps,
  events,
  organizationMembers,
  projectCollaborators,
  projects,
  users,
} from "~/server/db/schema";

export type ProfileAccessLevel = "full" | "minimal" | "hidden";

export interface ProfileAccess {
  level: ProfileAccessLevel;
  isSelf: boolean;
  /** Organisation ids both people belong to. Reused by the shared-context query. */
  sharedOrganizationIds: number[];
}

/** Organisation ids the two users have in common. */
export async function sharedOrganizationIds(
  db: typeof Database,
  viewerId: string,
  targetId: string,
): Promise<number[]> {
  const rows = await db
    .select({
      organizationId: organizationMembers.organizationId,
      userId: organizationMembers.userId,
    })
    .from(organizationMembers)
    .where(inArray(organizationMembers.userId, [viewerId, targetId]));

  const mine = new Set(
    rows.filter((r) => r.userId === viewerId).map((r) => r.organizationId),
  );

  return [
    ...new Set(
      rows
        .filter((r) => r.userId === targetId && mine.has(r.organizationId))
        .map((r) => r.organizationId),
    ),
  ];
}

/**
 * Whether the two users share a project, an event or a conversation.
 *
 * Short-circuits: the cheapest overlap is checked first and the rest are
 * skipped once one hits, because the answer is a boolean and the caller never
 * learns which one matched.
 */
export async function hasSharedContext(
  db: typeof Database,
  viewerId: string,
  targetId: string,
): Promise<boolean> {
  // Projects — either as collaborator or as owner.
  const projectRows = await db
    .select({
      projectId: projectCollaborators.projectId,
      userId: projectCollaborators.collaboratorId,
    })
    .from(projectCollaborators)
    .where(inArray(projectCollaborators.collaboratorId, [viewerId, targetId]));

  const ownerRows = await db
    .select({ projectId: projects.id, userId: projects.createdById })
    .from(projects)
    .where(inArray(projects.createdById, [viewerId, targetId]));

  const all = [...projectRows, ...ownerRows];
  const myProjects = new Set(
    all.filter((r) => r.userId === viewerId).map((r) => r.projectId),
  );
  if (all.some((r) => r.userId === targetId && myProjects.has(r.projectId))) {
    return true;
  }

  // Events — an RSVP on either side, or authorship of an event the other
  // RSVP'd to.
  const rsvpRows = await db
    .select({ eventId: eventRsvps.eventId, userId: eventRsvps.userId })
    .from(eventRsvps)
    .where(inArray(eventRsvps.userId, [viewerId, targetId]));

  const myEvents = new Set(
    rsvpRows.filter((r) => r.userId === viewerId).map((r) => r.eventId),
  );
  if (rsvpRows.some((r) => r.userId === targetId && myEvents.has(r.eventId))) {
    return true;
  }

  // Authorship counts too: the person whose event you RSVP'd to shares that
  // event with you, and vice versa. Checked as two directed questions rather
  // than one `inArray` over the union, which would match your own event
  // against your own RSVP and report a shared context with a stranger.
  const theirEventIds = [
    ...new Set(
      rsvpRows.filter((r) => r.userId === targetId).map((r) => r.eventId),
    ),
  ];

  if (myEvents.size > 0) {
    const theyAuthored = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(eq(events.createdById, targetId), inArray(events.id, [...myEvents])),
      )
      .limit(1);
    if (theyAuthored.length > 0) return true;
  }

  if (theirEventIds.length > 0) {
    const iAuthored = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(eq(events.createdById, viewerId), inArray(events.id, theirEventIds)),
      )
      .limit(1);
    if (iAuthored.length > 0) return true;
  }

  // Conversations — a thread neither party has left.
  const convoRows = await db
    .select({
      conversationId: conversationParticipants.conversationId,
      userId: conversationParticipants.userId,
    })
    .from(conversationParticipants)
    .where(
      and(
        inArray(conversationParticipants.userId, [viewerId, targetId]),
        isNull(conversationParticipants.leftAt),
      ),
    );

  const myConvos = new Set(
    convoRows.filter((r) => r.userId === viewerId).map((r) => r.conversationId),
  );
  return convoRows.some(
    (r) => r.userId === targetId && myConvos.has(r.conversationId),
  );
}

export async function resolveProfileAccess(
  db: typeof Database,
  viewerId: string,
  targetId: string,
): Promise<ProfileAccess> {
  if (viewerId === targetId) {
    return { level: "full", isSelf: true, sharedOrganizationIds: [] };
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: { id: true, profileVisibility: true, profileAudience: true },
  });

  if (!target) {
    return { level: "hidden", isSelf: false, sharedOrganizationIds: [] };
  }

  const orgIds = await sharedOrganizationIds(db, viewerId, targetId);

  if (!target.profileVisibility) {
    return { level: "minimal", isSelf: false, sharedOrganizationIds: orgIds };
  }

  const allowed =
    target.profileAudience === "everyone"
      ? true
      : target.profileAudience === "organization"
        ? orgIds.length > 0
        : await hasSharedContext(db, viewerId, targetId);

  return {
    level: allowed ? "full" : "minimal",
    isSelf: false,
    sharedOrganizationIds: orgIds,
  };
}

/** Whether `lastSeenAt` counts as online. Five minutes, matching the bell's poll. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function isOnline(lastSeenAt: Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}
