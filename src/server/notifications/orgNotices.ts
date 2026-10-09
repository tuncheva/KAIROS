/**
 * What a workspace membership change says to the people it affects.
 *
 * Two code paths change memberships: the organization router, when an admin
 * clicks, and the A5 org-admin agent, when the agent applies a plan the admin
 * approved. Both call these helpers, so a demotion or a removal reads the same on
 * the bell and on the lock screen whichever way it was made — and neither path
 * can forget to say anything, which until now both did for every change except
 * an invite.
 *
 * Everything here goes through `notify` / `notifyMany`, so preferences, the
 * self-skip and Web Push all apply. The lookups around them are guarded too:
 * nothing here throws, because a notice is a side effect of a mutation that has
 * already happened.
 */

import { and, eq, sql } from "drizzle-orm";

import {
  PERMISSION_FLAG_KEYS,
  flagsForRole,
  type MemberPermissionFlags,
  type OrgRole,
  type PermissionFlag,
} from "~/lib/permissions";
import type { db as Database } from "~/server/db";
import {
  organizationInvites,
  organizationMembers,
  organizations,
  users,
  type OrganizationInvite,
} from "~/server/db/schema";
import { sendOrganizationInvite } from "~/server/email/email";
import { createLogger } from "~/server/logger";
import {
  PERMISSION_LABELS_EN,
  grantedLabelsEn,
  roleLabelEn,
  storedGrantFlags,
} from "~/server/orgs/inviteGrants";
import { isSuppressed, optOutToken } from "~/server/orgs/invitePolicy";

import { notify, notifyMany } from "./dispatch";

const log = createLogger("notifications.org");

type Db = typeof Database;

/** Matches the router's own invite lifetime; used only when a row has none. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const WORKSPACE_LINK = "/settings?section=workspace";

/**
 * Where to send somebody who no longer belongs to the workspace.
 *
 * The workspace settings page is the one place they cannot open any more, so a
 * notice about losing access points somewhere they still can.
 */
const OUTSIDE_LINK = "/dashboard";

async function actorName(db: Db, userId: string): Promise<string> {
  const [actor] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return actor?.name ?? actor?.email ?? "Someone";
}

async function orgName(db: Db, organizationId: number): Promise<string> {
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org?.name ?? "a workspace";
}

/** Run a notice, logging rather than throwing if one of its lookups fails. */
async function guarded(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    log.error("workspace notice failed", { err, notice: what });
  }
}

/** The flags that differ between two states, split by direction. */
export function permissionDiff(
  before: MemberPermissionFlags,
  after: Partial<MemberPermissionFlags>,
): { granted: PermissionFlag[]; revoked: PermissionFlag[] } {
  const granted: PermissionFlag[] = [];
  const revoked: PermissionFlag[] = [];
  for (const key of PERMISSION_FLAG_KEYS) {
    const next = after[key];
    if (next === undefined || next === before[key]) continue;
    (next ? granted : revoked).push(key);
  }
  return { granted, revoked };
}

/** A member's role was changed by somebody else. */
export async function noticeRoleChanged(input: {
  db: Db;
  organizationId: number;
  userId: string;
  actorId: string;
  from: { role: OrgRole; displayRole: string | null };
  to: { role: OrgRole; displayRole: string | null };
}): Promise<void> {
  const fromLabel = roleLabelEn(input.from.role, input.from.displayRole);
  const toLabel = roleLabelEn(input.to.role, input.to.displayRole);
  // Re-applying the same role is a no-op from the member's point of view.
  if (fromLabel === toLabel && input.from.role === input.to.role) return;

  await guarded("roleChanged", async () => {
    const [actor, org] = await Promise.all([
      actorName(input.db, input.actorId),
      orgName(input.db, input.organizationId),
    ]);
    await notify({
      db: input.db,
      userId: input.userId,
      actorId: input.actorId,
      category: "workspace",
      type: "system",
      title: "Your Role Changed",
      message: `${actor} changed your role in "${org}" from ${fromLabel} to ${toLabel}`,
      link: WORKSPACE_LINK,
    });
  });
}

/** A member's individual capability flags were changed by somebody else. */
export async function noticePermissionsChanged(input: {
  db: Db;
  organizationId: number;
  userId: string;
  actorId: string;
  granted: readonly PermissionFlag[];
  revoked: readonly PermissionFlag[];
}): Promise<void> {
  if (input.granted.length === 0 && input.revoked.length === 0) return;

  await guarded("permissionsChanged", async () => {
    const [actor, org] = await Promise.all([
      actorName(input.db, input.actorId),
      orgName(input.db, input.organizationId),
    ]);
    const parts: string[] = [];
    if (input.granted.length) {
      parts.push(`granted ${input.granted.map((f) => PERMISSION_LABELS_EN[f]).join(", ")}`);
    }
    if (input.revoked.length) {
      parts.push(`revoked ${input.revoked.map((f) => PERMISSION_LABELS_EN[f]).join(", ")}`);
    }
    await notify({
      db: input.db,
      userId: input.userId,
      actorId: input.actorId,
      category: "workspace",
      type: "system",
      title: "Your Permissions Changed",
      message: `${actor} updated your permissions in "${org}": ${parts.join("; ")}`,
      link: WORKSPACE_LINK,
    });
  });
}

/** A member was removed from the workspace by somebody else. */
export async function noticeMemberRemoved(input: {
  db: Db;
  organizationId: number;
  userId: string;
  actorId: string;
}): Promise<void> {
  await guarded("memberRemoved", async () => {
    const [actor, org] = await Promise.all([
      actorName(input.db, input.actorId),
      orgName(input.db, input.organizationId),
    ]);
    await notify({
      db: input.db,
      userId: input.userId,
      actorId: input.actorId,
      category: "workspace",
      type: "system",
      title: "Removed From Workspace",
      message: `${actor} removed you from "${org}"`,
      link: OUTSIDE_LINK,
    });
  });
}

/**
 * A member left of their own accord. Told to the people who manage the
 * workspace: every admin, plus the creator in case they are no longer one.
 */
export async function noticeMemberLeft(input: {
  db: Db;
  organizationId: number;
  leaverId: string;
}): Promise<void> {
  await guarded("memberLeft", async () => {
    const [org] = await input.db
      .select({ name: organizations.name, createdById: organizations.createdById })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);
    if (!org) return;

    const admins = await input.db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.role, "admin"),
        ),
      );

    const leaver = await actorName(input.db, input.leaverId);
    await notifyMany({
      db: input.db,
      userIds: [...admins.map((a) => a.userId), ...(org.createdById ? [org.createdById] : [])],
      actorId: input.leaverId,
      category: "workspace",
      type: "system",
      title: "Member Left",
      message: `${leaver} left "${org.name}"`,
      link: WORKSPACE_LINK,
    });
  });
}

/**
 * The workspace was deleted. The caller reads `memberIds` before the delete
 * cascades the membership away.
 */
export async function noticeOrganizationDeleted(input: {
  db: Db;
  organizationName: string;
  memberIds: string[];
  actorId: string;
}): Promise<void> {
  await guarded("organizationDeleted", async () => {
    const actor = await actorName(input.db, input.actorId);
    await notifyMany({
      db: input.db,
      userIds: input.memberIds,
      actorId: input.actorId,
      category: "workspace",
      type: "system",
      title: "Workspace Deleted",
      message: `${actor} deleted the workspace "${input.organizationName}"`,
      link: OUTSIDE_LINK,
    });
  });
}

/** A pending invite was withdrawn. Only an invitee with an account can be told in-app. */
export async function noticeInviteCancelled(input: {
  db: Db;
  organizationId: number;
  email: string;
  actorId: string;
}): Promise<void> {
  await guarded("inviteCancelled", async () => {
    const [invitee] = await input.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email.trim().toLowerCase()}`)
      .limit(1);
    if (!invitee) return;

    const org = await orgName(input.db, input.organizationId);
    await notify({
      db: input.db,
      userId: invitee.id,
      actorId: input.actorId,
      category: "invite",
      type: "system",
      title: "Invitation Cancelled",
      message: `Your invitation to join "${org}" was cancelled`,
      link: OUTSIDE_LINK,
    });
  });
}

/** What the inviter is told when an invitation email did not go out. */
const NOT_DELIVERED = "Invite could not be delivered";

/**
 * Tell the invitee: by email, and in-app when they already have an account —
 * unless the address asked never to be sent invitations.
 *
 * A failed email does not undo the invite — the caller is told instead, and can
 * resend or share a link — because the invite is still valid and an invitee
 * who already has an account will see it in the app.
 *
 * A suppressed address is reported with exactly the same result as a failed
 * send, and a failed send never passes the provider's error through. Either
 * difference would let an inviter learn that this person opted out of KAIROS
 * invitations, which is itself something about them we have no reason to tell.
 */
export async function deliverOrgInvite(input: {
  db: Db;
  invite: OrganizationInvite;
  token: string;
  inviterId: string;
  existingUserId: string | null;
}): Promise<{ emailSent: boolean; emailError: string | null }> {
  try {
    return await deliverOrgInviteUnguarded(input);
  } catch (err) {
    // The invite row exists and stays valid; only the telling failed.
    log.error("invite delivery failed", { err, inviteId: input.invite.id });
    return { emailSent: false, emailError: NOT_DELIVERED };
  }
}

async function deliverOrgInviteUnguarded(input: {
  db: Db;
  invite: OrganizationInvite;
  token: string;
  inviterId: string;
  existingUserId: string | null;
}): Promise<{ emailSent: boolean; emailError: string | null }> {
  const { db, invite, token } = input;

  if (await isSuppressed(db, invite.email)) {
    return { emailSent: false, emailError: NOT_DELIVERED };
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.organizationId))
    .limit(1);
  const [inviter] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, input.inviterId))
    .limit(1);

  const inviterName = inviter?.name ?? inviter?.email ?? "Someone";
  const organizationName = org?.name ?? "a workspace";
  const roleLabel = roleLabelEn(invite.role, invite.displayRole);
  const flags = storedGrantFlags(invite.permissions, flagsForRole(invite.role));

  let emailSent = false;
  let emailError: string | null = null;
  try {
    await sendOrganizationInvite({
      email: invite.email,
      inviterName,
      inviterEmail: inviter?.email ?? null,
      organizationName,
      roleLabel,
      permissionLabels: grantedLabelsEn(flags),
      token,
      expiresAt: invite.expiresAt ?? new Date(Date.now() + INVITE_TTL_MS),
      optOutToken: optOutToken(invite.email),
    });
    emailSent = true;
    await db
      .update(organizationInvites)
      .set({ lastSentAt: new Date() })
      .where(eq(organizationInvites.id, invite.id));
  } catch (error) {
    emailError = NOT_DELIVERED;
    log.error("invite email failed", { err: error, inviteId: invite.id });
  }

  if (input.existingUserId) {
    await notify({
      db,
      userId: input.existingUserId,
      actorId: input.inviterId,
      category: "invite",
      type: "system",
      title: "Workspace Invitation",
      message: `${inviterName} invited you to join "${organizationName}" as ${roleLabel}`,
      link: `/invite/${encodeURIComponent(token)}`,
    });
  }

  return { emailSent, emailError };
}
