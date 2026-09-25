
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, type TRPCContext } from "~/server/api/trpc";
import { organizations, organizationMembers, organizationRoles, organizationInvites, organizationJoinCodes, users, type OrganizationInvite, type OrganizationJoinCode } from "~/server/db/schema";
import {
  ORG_ROLES,
  baseRoleForFlags,
  flagsForRole,
  isOrgRole,
  pickPermissionFlags,
  type OrgRole,
} from "~/lib/permissions";
import {
  generateInviteToken,
  grantedLabelsEn,
  hashInviteToken,
  inviteGrantSchema,
  permissionFlagsSchema,
  resolveGrant,
  roleLabelEn,
  storedGrantFlags,
} from "~/server/orgs/inviteGrants";
import { sendOrganizationInvite } from "~/server/email/email";
import { consumeAuthRateLimit, createAuthRateLimitKey } from "~/server/security/authRateLimit";
import { getClientIp } from "~/server/http/clientIp";
import { assertSeatAvailable } from "~/server/billing/seats";
import {
  JOIN_CODE_TTL_MS,
  buildJoinUrl,
  generateJoinToken,
  renderJoinQrSvg,
  resolveOrigin,
} from "~/server/orgs/joinCodes";

/**
 * Who may hand out access to the workspace.
 *
 * Invites are a bearer credential, so this is deliberately narrower than
 * membership: the view-only `mentor` and `guest` roles can see the workspace but
 * must not be able to grow it.
 */
function canInvite(membership: {
  role: string;
  canAddMembers?: boolean;
}): boolean {
  return membership.role === "admin" || membership.canAddMembers === true;
}

import { eq, and, or, isNull, gt, lte, desc, sql } from "drizzle-orm";
import { notify } from "~/server/notifications/dispatch";
import { createLogger } from "~/server/logger";
import {
  cancelSubscriptionFor,
  SubscriptionCancellationError,
} from "~/server/billing/subscriptions";

const log = createLogger("organization");


function generateAccessCode(): string {
  // SECURITY: use cryptographically secure randomness with rejection sampling
  // to avoid modulo bias. Generates a code like XXXX-XXXX-XXXX.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const maxValid = 256 - (256 % alphabet.length); // reject values >= maxValid

  let code = "";
  let generated = 0;
  while (generated < 12) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (generated >= 12) break;
      if (b >= maxValid) continue; // rejection sampling to eliminate bias
      if (generated > 0 && generated % 4 === 0) code += "-";
      code += alphabet[b % alphabet.length];
      generated++;
    }
  }

  return code;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The caller's membership, once it has been established they may invite. */
type InviteContext = {
  organizationId: number;
  organizationName: string;
};

/**
 * Resolve which organisation an invite action targets and check the caller may
 * grow it. Omitting `organizationId` means "the one I am working in".
 */
async function requireInviteRights(
  ctx: TRPCContext & { session: { user: { id: string } } },
  organizationId: number | null,
): Promise<InviteContext> {
  const conditions = [eq(organizationMembers.userId, ctx.session.user.id)];
  if (organizationId !== null) {
    conditions.push(eq(organizationMembers.organizationId, organizationId));
  } else {
    // No explicit target: fall back to the user's active organisation so the
    // topbar can offer an invite without knowing an id.
    const [user] = await ctx.db
      .select({ activeOrganizationId: users.activeOrganizationId })
      .from(users)
      .where(eq(users.id, ctx.session.user.id))
      .limit(1);

    if (!user?.activeOrganizationId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No active organization to invite into.",
      });
    }
    conditions.push(
      eq(organizationMembers.organizationId, user.activeOrganizationId),
    );
  }

  const [membership] = await ctx.db
    .select({
      organizationId: organizationMembers.organizationId,
      organizationName: organizations.name,
      role: organizationMembers.role,
      canAddMembers: organizationMembers.canAddMembers,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizationMembers.organizationId, organizations.id),
    )
    .where(and(...conditions))
    .limit(1);

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization",
    });
  }

  if (!canInvite(membership)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to invite people to this organization",
    });
  }

  return {
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
  };
}

/** Shape a stored token into what the invite dialog needs to render it. */
async function describeJoinCode(
  headers: Headers | undefined,
  code: OrganizationJoinCode,
  organizationName: string,
) {
  const url = buildJoinUrl(resolveOrigin(headers), code.code);

  return {
    code: code.code,
    url,
    qrSvg: await renderJoinQrSvg(url),
    expiresAt: code.expiresAt,
    ttlMs: JOIN_CODE_TTL_MS,
    maxUses: code.maxUses,
    usedCount: code.usedCount,
    role: code.role,
    organizationName,
  };
}

function describeInviteLink(headers: Headers | undefined, link: OrganizationJoinCode) {
  const grant = joinCodeGrant(link);
  return {
    id: link.id,
    code: link.code,
    url: buildJoinUrl(resolveOrigin(headers), link.code),
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    usedCount: link.usedCount,
    createdAt: link.createdAt,
    ...grant,
  };
}

type AuthedContext = TRPCContext & { session: { user: { id: string } } };

/** Invite links live longer than the on-screen QR, but not indefinitely. */
const INVITE_LINK_DEFAULT_DAYS = 7;
const INVITE_LINK_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Addresses are compared case-insensitively everywhere.
 *
 * `inviteMember` used to store the address as typed while `acceptInvite`
 * compared it exactly against `users.email`, so "Ana@Gmail.com" invited
 * "ana@gmail.com" to nothing.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function inviteEmailIs(email: string) {
  return sql`lower(${organizationInvites.email}) = ${normalizeEmail(email)}`;
}

/** An invite row as it may leave the server: never with its token hash. */
function publicInvite(invite: OrganizationInvite) {
  const { acceptTokenHash: _hash, ...rest } = invite;
  return {
    ...rest,
    permissions: storedGrantFlags(invite.permissions, flagsForRole(invite.role)),
  };
}

/** The flags a join code grants, and the role it admits as. */
function joinCodeGrant(code: OrganizationJoinCode) {
  // A QR only ever admitted worker or mentor; a hand-made link carries whatever
  // role its creator was allowed to pick.
  const role: OrgRole =
    code.kind === "link" ? code.role : code.role === "mentor" ? "mentor" : "worker";
  return {
    role,
    displayRole: code.displayRole ?? null,
    permissions: storedGrantFlags(code.permissions, flagsForRole(role)),
  };
}

/**
 * Turn a pending invite into a membership with exactly the flags it carries.
 *
 * Shared by accepting from the inbox and accepting from the emailed link, so
 * the two cannot drift into granting different things.
 */
async function admitInvite(ctx: AuthedContext, invite: OrganizationInvite) {
  const [existingMember] = await ctx.db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, invite.organizationId),
        eq(organizationMembers.userId, ctx.session.user.id),
      ),
    )
    .limit(1);

  const [org] = await ctx.db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.organizationId))
    .limit(1);
  const orgName = org?.name ?? "Workspace";

  if (existingMember) {
    await ctx.db
      .update(organizationInvites)
      .set({ status: "accepted" })
      .where(eq(organizationInvites.id, invite.id));
    return { success: true, alreadyMember: true, organizationName: orgName };
  }

  // An invitation is not a reservation: it can be issued while a seat is
  // free and accepted after it has been taken, so the seat is checked at
  // acceptance rather than at send.
  await assertSeatAvailable(invite.organizationId);

  const role = invite.role ?? "member";
  await ctx.db.insert(organizationMembers).values({
    organizationId: invite.organizationId,
    userId: ctx.session.user.id,
    role,
    displayRole: invite.displayRole,
    // Exactly what the inviter ticked — not the role's template, which is what
    // this used to apply, silently discarding every hand-picked flag.
    ...storedGrantFlags(invite.permissions, flagsForRole(role)),
  });

  await ctx.db
    .update(organizationInvites)
    .set({ status: "accepted" })
    .where(eq(organizationInvites.id, invite.id));

  await ctx.db
    .update(users)
    .set({ usageMode: "organization", activeOrganizationId: invite.organizationId })
    .where(eq(users.id, ctx.session.user.id));

  const [acceptingUser] = await ctx.db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ctx.session.user.id))
    .limit(1);
  const acceptorName = acceptingUser?.name ?? "Someone";

  if (invite.invitedById) {
    await notify({
      db: ctx.db,
      userId: invite.invitedById,
      actorId: ctx.session.user.id,
      category: "workspace",
      type: "system",
      title: "Invite Accepted",
      message: `${acceptorName} accepted your invitation to join "${orgName}"`,
      link: "/settings",
    });
  }

  return { success: true, alreadyMember: false, organizationName: orgName };
}

/**
 * Redeem a join code — a scanned QR, a shared invite link, or the same code
 * typed into the join box. The caller is responsible for rate limiting.
 */
async function redeemJoinCode(ctx: AuthedContext, rawCode: string) {
  const code = rawCode.trim().toUpperCase();

  const [candidate] = await ctx.db
    .select()
    .from(organizationJoinCodes)
    .where(eq(organizationJoinCodes.code, code))
    .limit(1);

  if (
    !candidate ||
    candidate.revokedAt ||
    candidate.expiresAt.getTime() <= Date.now() ||
    candidate.usedCount >= candidate.maxUses
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This invite code is no longer valid. Ask for a fresh one.",
    });
  }

  const [existingMember] = await ctx.db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, candidate.organizationId),
        eq(organizationMembers.userId, ctx.session.user.id),
      ),
    )
    .limit(1);

  if (existingMember) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You are already a member of this organization.",
    });
  }

  // Before the claim below, deliberately: a full organization should not
  // burn a use off a single-use code that was never going to admit anyone.
  // The rollback in the catch handles a failed *insert*; refusing here means
  // there is nothing to roll back.
  await assertSeatAvailable(candidate.organizationId);

  // Claim a use with a conditional update rather than a read-then-write, so
  // two people redeeming the same single-use code at once cannot both win.
  const claimed = await ctx.db
    .update(organizationJoinCodes)
    .set({ usedCount: sql`${organizationJoinCodes.usedCount} + 1` })
    .where(
      and(
        eq(organizationJoinCodes.id, candidate.id),
        isNull(organizationJoinCodes.revokedAt),
        gt(organizationJoinCodes.expiresAt, new Date()),
        sql`${organizationJoinCodes.usedCount} < ${organizationJoinCodes.maxUses}`,
      ),
    )
    .returning({ id: organizationJoinCodes.id });

  if (claimed.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This invite code is no longer valid. Ask for a fresh one.",
    });
  }

  const [organization] = await ctx.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, candidate.organizationId))
    .limit(1);

  if (!organization) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Organization not found",
    });
  }

  const grant = joinCodeGrant(candidate);

  try {
    await ctx.db.insert(organizationMembers).values({
      organizationId: organization.id,
      userId: ctx.session.user.id,
      role: grant.role,
      displayRole: grant.displayRole,
      ...grant.permissions,
    });
  } catch (error) {
    // Hand the use back so a failed insert does not burn a single-use code.
    await ctx.db
      .update(organizationJoinCodes)
      .set({ usedCount: sql`greatest(${organizationJoinCodes.usedCount} - 1, 0)` })
      .where(eq(organizationJoinCodes.id, candidate.id));
    throw error;
  }

  await ctx.db
    .update(users)
    .set({ usageMode: "organization", activeOrganizationId: organization.id })
    .where(eq(users.id, ctx.session.user.id));

  const [joiner] = await ctx.db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ctx.session.user.id))
    .limit(1);
  const joinerName = joiner?.name ?? "Someone";

  const orgAdmins = await ctx.db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organization.id),
        eq(organizationMembers.role, "admin"),
      ),
    );

  const how = candidate.kind === "link" ? "using an invite link" : "by scanning an invite QR";
  for (const admin of orgAdmins) {
    if (admin.userId === ctx.session.user.id) continue;
    await notify({
      db: ctx.db,
      userId: admin.userId,
      actorId: ctx.session.user.id,
      category: "workspace",
      type: "system",
      title: "New Member Joined",
      message: `${joinerName} joined "${organization.name}" ${how}`,
      link: "/settings?section=workspace",
    });
  }

  return {
    success: true,
    organizationId: organization.id,
    organizationName: organization.name,
    role: grant.role,
  };
}

/**
 * Role names are unique per organization, case-insensitively, and may not
 * shadow a built-in role — two "Designer" cards, or a custom "Admin" that is
 * not an admin, would make the role picker ambiguous.
 */
async function assertRoleNameFree(
  ctx: AuthedContext,
  organizationId: number,
  name: string,
  exceptRoleId?: number,
) {
  const normalized = name.trim().toLowerCase();
  if (isOrgRole(normalized)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `"${name.trim()}" is a built-in role. Pick another name.`,
    });
  }
  const [clash] = await ctx.db
    .select({ id: organizationRoles.id })
    .from(organizationRoles)
    .where(
      and(
        eq(organizationRoles.organizationId, organizationId),
        sql`lower(${organizationRoles.name}) = ${normalized}`,
        exceptRoleId === undefined ? undefined : sql`${organizationRoles.id} <> ${exceptRoleId}`,
      ),
    )
    .limit(1);
  if (clash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A role named "${name.trim()}" already exists.`,
    });
  }
}

/**
 * Tell the invitee: by email always, and in-app when they already have an
 * account.
 *
 * A failed email does not undo the invite — the admin is told instead, and can
 * resend or share a link — because the invite is still valid and an invitee
 * who already has an account will see it in the app.
 */
async function deliverInvite(
  ctx: AuthedContext,
  invite: OrganizationInvite,
  token: string,
  existingUserId: string | null,
): Promise<{ emailSent: boolean; emailError: string | null }> {
  const [org] = await ctx.db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.organizationId))
    .limit(1);
  const [inviter] = await ctx.db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.session.user.id))
    .limit(1);

  const inviterName = inviter?.name ?? inviter?.email ?? "Someone";
  const orgName = org?.name ?? "a workspace";
  const roleLabel = roleLabelEn(invite.role, invite.displayRole);
  const flags = storedGrantFlags(invite.permissions, flagsForRole(invite.role));

  let emailSent = false;
  let emailError: string | null = null;
  try {
    await sendOrganizationInvite({
      email: invite.email,
      inviterName,
      organizationName: orgName,
      roleLabel,
      permissionLabels: grantedLabelsEn(flags),
      token,
      expiresAt: invite.expiresAt ?? new Date(Date.now() + INVITE_TTL_MS),
    });
    emailSent = true;
  } catch (error) {
    emailError = error instanceof Error ? error.message : "Email could not be sent";
    log.error("invite email failed", { err: error, inviteId: invite.id });
  }

  if (existingUserId) {
    await notify({
      db: ctx.db,
      userId: existingUserId,
      actorId: ctx.session.user.id,
      category: "invite",
      type: "system",
      title: "Workspace Invitation",
      message: `${inviterName} invited you to join "${orgName}" as ${roleLabel}`,
      link: `/invite/${encodeURIComponent(token)}`,
    });
  }

  return { emailSent, emailError };
}

/** The shape of every join code: 26 characters of the token alphabet. */
const JOIN_TOKEN_PATTERN = /^[ABCDEFGHJKMNPQRSTVWXYZ0-9]{26}$/;

export const organizationRouter = createTRPCRouter({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db
      .select({
        organization: organizations,
        role: organizationMembers.role,
        canAddMembers: organizationMembers.canAddMembers,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(eq(organizationMembers.userId, ctx.session.user.id));

    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      image: m.organization.image,
      canInvite: canInvite(m),
      /* Only the creator may delete the workspace, and the row has to know
         that before it can decide whether to paint the control. */
      isOwner: m.organization.createdById === ctx.session.user.id,
      role: m.role,
      joinedAt: m.joinedAt,
      createdAt: m.organization.createdAt,
    }));
  }),

  getActive: protectedProcedure.query(async ({ ctx }) => {
    let activeOrganizationId: number | null = null;
    let usageMode: (typeof users.$inferSelect)["usageMode"] = null;

    try {
      const [user] = await ctx.db
        .select({
          activeOrganizationId: users.activeOrganizationId,
          usageMode: users.usageMode,
        })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      activeOrganizationId = user?.activeOrganizationId ?? null;
      usageMode = user?.usageMode ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("active_organization_id")) {
        throw err;
      }
      // Backwards-compat: DB may not have been migrated yet.
      const [user] = await ctx.db
        .select({ usageMode: users.usageMode })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      activeOrganizationId = null;
      usageMode = user?.usageMode ?? null;
    }

    // Working personally is an answer, not a missing one.
    //
    // The membership fallback below used to run unconditionally, so
    // `user.setPersonalMode` — which clears `activeOrganizationId` and sets
    // `usageMode` to "personal" — was overruled on the very next read by
    // whichever membership the database happened to return first. Personal
    // workspace was therefore a one-way door: reachable at onboarding, and
    // never again once you belonged to an organisation.
    if (usageMode === "personal") return null;

    if (activeOrganizationId) {
      const [membership] = await ctx.db
        .select({
          organization: organizations,
          role: organizationMembers.role,
          canAddMembers: organizationMembers.canAddMembers,
        })
        .from(organizationMembers)
        .innerJoin(
          organizations,
          eq(organizationMembers.organizationId, organizations.id),
        )
        .where(
          and(
            eq(organizationMembers.userId, ctx.session.user.id),
            eq(organizationMembers.organizationId, activeOrganizationId),
          ),
        )
        .limit(1);

      if (membership) {
        return {
          organization: {
            id: membership.organization.id,
            name: membership.organization.name,
            image: membership.organization.image,
          },
          role: membership.role,
          canInvite: canInvite(membership),
        };
      }
    }

    // No active organisation recorded — someone who has never switched, or whose
    // stored organisation they are no longer a member of. Ordered so the answer
    // is the same on every call: an unordered `limit(1)` let the workspace name
    // flip between memberships as the planner changed its mind.
    const [fallback] = await ctx.db
      .select({
        organization: organizations,
        role: organizationMembers.role,
        canAddMembers: organizationMembers.canAddMembers,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(eq(organizationMembers.userId, ctx.session.user.id))
      .orderBy(organizationMembers.joinedAt, organizationMembers.id)
      .limit(1);

    if (!fallback) return null;

    return {
      organization: {
        id: fallback.organization.id,
        name: fallback.organization.name,
        image: fallback.organization.image,
      },
      role: fallback.role,
      canInvite: canInvite(fallback),
    };
  }),

  /**
   * Set or clear the workspace's logo. Admin-only, mirroring the other
   * organization-wide settings — a logo is branding, not a personal preference.
   */
  updateImage: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        image: z.string().url().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [membership] = await ctx.db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, ctx.session.user.id),
            eq(organizationMembers.organizationId, input.organizationId),
          ),
        )
        .limit(1);

      if (membership?.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an admin can change the workspace logo.",
        });
      }

      await ctx.db
        .update(organizations)
        .set({ image: input.image, updatedAt: new Date() })
        .where(eq(organizations.id, input.organizationId));

      return { success: true, image: input.image };
    }),

  setActive: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [membership] = await ctx.db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, ctx.session.user.id),
            eq(organizationMembers.organizationId, input.organizationId),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      await ctx.db
        .update(users)
        .set({
          usageMode: "organization",
          activeOrganizationId: input.organizationId,
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        
        let accessCode = generateAccessCode();
        let isUnique = false;
        
        
        while (!isUnique) {
          const [existing] = await ctx.db
            .select()
            .from(organizations)
            .where(eq(organizations.accessCode, accessCode))
            .limit(1);
          
          if (!existing) {
            isUnique = true;
          } else {
            accessCode = generateAccessCode();
          }
        }

        
        const [organization] = await ctx.db
          .insert(organizations)
          .values({
            name: input.name,
            accessCode: accessCode,
            createdById: ctx.session.user.id,
          })
          .returning();

        if (!organization) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create organization",
          });
        }

        
        // Flags come from the role template rather than being hand-listed, so
        // there is exactly one definition of what a role can do
        // (`~/lib/permissions`). The eight columns are what the server authorizes
        // on, so every membership insert must populate them.
        await ctx.db.insert(organizationMembers).values({
          organizationId: organization.id,
          userId: ctx.session.user.id,
          role: "admin",
          ...flagsForRole("admin"),
        });

        
        await ctx.db
          .update(users)
          .set({ usageMode: "organization", activeOrganizationId: organization.id })
          .where(eq(users.id, ctx.session.user.id));

        return {
          id: organization.id,
          name: organization.name,
          accessCode: organization.accessCode,
        };
      } catch (error) {
        log.error("failed to create organization", { err: error });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create organization",
        });
      }
    }),


  join: protectedProcedure
    .input(
      z.object({
        code: z.string().min(1),
        role: z.enum(["worker", "mentor"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Access codes are a 12-character shared secret and this endpoint says
      // whether a guess was right, so without a limit it is an oracle for
      // enumerating them. Keyed on the caller and on client IP.
      await consumeAuthRateLimit(
        createAuthRateLimitKey("org_join", ctx.session.user.id),
      );
      await consumeAuthRateLimit(
        createAuthRateLimitKey("org_join_ip", getClientIp(ctx.headers)),
      );

      try {
        
        const [organization] = await ctx.db
          .select()
          .from(organizations)
          .where(eq(organizations.accessCode, input.code.trim().toUpperCase()));

        // The same box accepts an invite code an admin shared by hand. Those
        // carry their own role and flags, so `input.role` does not apply.
        if (!organization && JOIN_TOKEN_PATTERN.test(input.code.trim().toUpperCase())) {
          return await redeemJoinCode(ctx, input.code);
        }

        if (!organization) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invalid access code. Please check and try again.",
          });
        }

        
        const [existingMember] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organization.id),
              eq(organizationMembers.userId, ctx.session.user.id)
            )
          );

        if (existingMember) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You are already a member of this organization.",
          });
        }

        // After the membership check, so someone already inside a full
        // organization is told they are already a member rather than that there
        // is no room for them.
        await assertSeatAvailable(organization.id);

        // This used to insert every flag as false regardless of role, which is
        // why nothing could safely read the columns: a "worker" joining by access
        // code arrived with no capabilities at all. Derive them from the role.
        const joinRole = input.role ?? "worker";
        await ctx.db.insert(organizationMembers).values({
          organizationId: organization.id,
          userId: ctx.session.user.id,
          role: joinRole,
          ...flagsForRole(joinRole),
        });

        
        await ctx.db
          .update(users)
          .set({ usageMode: "organization", activeOrganizationId: organization.id })
          .where(eq(users.id, ctx.session.user.id));

        // Notify org admins that a new member joined
        const [joinerUser] = await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ctx.session.user.id))
          .limit(1);
        const joinerName = joinerUser?.name ?? "Someone";

        const orgAdmins = await ctx.db
          .select({ userId: organizationMembers.userId })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organization.id),
              eq(organizationMembers.role, "admin"),
            ),
          );

        for (const admin of orgAdmins) {
          if (admin.userId === ctx.session.user.id) continue;
          await notify({
            db: ctx.db,
            userId: admin.userId,
            actorId: ctx.session.user.id,
            category: "workspace",
            type: "system",
            title: "New Member Joined",
            message: `${joinerName} joined "${organization.name}" via access code`,
            link: "/settings",
          });
        }

        return {
          success: true,
          organizationName: organization.name,
        };
      } catch (error) {
        log.error("failed to join organization", { err: error });
        if (error instanceof Error) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to join organization",
        });
      }
    }),


  getMembers: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      
      const [membership] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id)
          )
        );

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      
      const members = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          role: organizationMembers.role,
          displayRole: organizationMembers.displayRole,
          joinedAt: organizationMembers.joinedAt,
          // All eight, so the roster shows what someone can actually do rather
          // than what their role's template would have given them.
          canAddMembers: organizationMembers.canAddMembers,
          canAssignTasks: organizationMembers.canAssignTasks,
          canCreateProjects: organizationMembers.canCreateProjects,
          canDeleteTasks: organizationMembers.canDeleteTasks,
          canKickMembers: organizationMembers.canKickMembers,
          canManageRoles: organizationMembers.canManageRoles,
          canEditProjects: organizationMembers.canEditProjects,
          canViewAnalytics: organizationMembers.canViewAnalytics,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(eq(organizationMembers.organizationId, input.organizationId));

      return members;
    }),

  getProjectInviteCandidates: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [membership] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      const candidates = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(eq(organizationMembers.organizationId, input.organizationId))
        .orderBy(users.name);

      return candidates.filter((c) => c.id !== ctx.session.user.id);
    }),

  
  leave: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [membership] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, ctx.session.user.id),
            eq(organizationMembers.organizationId, input.organizationId),
          ),
        )
        .limit(1);

      if (!membership) {
        // TRPCError, not a bare Error: a bare throw reaches the client as HTTP 500
        // with the message masked to "Internal server error" in production, so the
        // user sees nothing actionable and monitoring records an authz denial as a
        // server fault.
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      if (membership.role === "admin") {
        const [organization] = await ctx.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, membership.organizationId))
          .limit(1);

        if (organization?.createdById === ctx.session.user.id) {
          const admins = await ctx.db
            .select()
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.organizationId, membership.organizationId),
                eq(organizationMembers.role, "admin"),
              ),
            );

          if (admins.length === 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "You cannot leave as you are the only admin. Please transfer ownership or delete the organization.",
            });
          }
        }
      }

      await ctx.db
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, ctx.session.user.id),
            eq(organizationMembers.organizationId, input.organizationId),
          ),
        );

      const [user] = await ctx.db
        .select({ activeOrganizationId: users.activeOrganizationId })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      if (user?.activeOrganizationId === input.organizationId) {
        const [nextMembership] = await ctx.db
          .select({ organizationId: organizationMembers.organizationId })
          .from(organizationMembers)
          .where(eq(organizationMembers.userId, ctx.session.user.id))
          .limit(1);

        if (!nextMembership) {
          await ctx.db
            .update(users)
            .set({ usageMode: "personal", activeOrganizationId: null })
            .where(eq(users.id, ctx.session.user.id));
        } else {
          await ctx.db
            .update(users)
            .set({ activeOrganizationId: nextMembership.organizationId })
            .where(eq(users.id, ctx.session.user.id));
        }
      }

      return { success: true };
    }),

  /**
   * Deleting the whole workspace.
   *
   * Restricted to the creator: an admin can be promoted by another admin, but
   * destroying everyone else's projects, tasks and threads is the one act that
   * stays with whoever made the place.
   *
   * `confirmName` is checked here and not only in the dialog. The typed-name
   * gate is what makes this irreversible action deliberate, and a gate that
   * lives only in the client is not a gate — it protects nobody calling the
   * API directly, and nobody whose UI state got out of step with the row they
   * meant to delete.
   *
   * Everything owned by the organization goes with it through the foreign-key
   * cascades (members, roles, invites, join codes, projects, conversations).
   * `users.active_organization_id` is the exception: it is a plain integer with
   * no reference, so it would be left pointing at an organization that no
   * longer exists. Members are repointed by hand, below.
   */
  delete: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        confirmName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [organization] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      if (organization.createdById !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the workspace owner can delete it",
        });
      }

      /* Trimmed, because the name is typed by hand and a trailing space is a
         typing artefact rather than a different answer. Case is not folded:
         the point of the gate is that the user reproduced the name. */
      if (input.confirmName.trim() !== organization.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The name you typed does not match the workspace name",
        });
      }

      /* Stop the subscription before the row that points at it is gone.
         Deleting first left the Team plan running: Stripe kept charging the
         saved card, and every later webhook for that subscription resolved to no
         owner and was logged rather than acted on. Nobody notices until the
         chargeback, and by then there is no record here of what was being paid
         for.

         A failure here aborts the deletion rather than being logged and stepped
         over. That is the deliberate trade: refusing is recoverable — try again,
         or cancel from the portal — while deleting an organization whose
         subscription is still live is not. */
      try {
        await cancelSubscriptionFor({ kind: "organization", id: organization.id });
      } catch (error) {
        if (error instanceof SubscriptionCancellationError) {
          log.error("refusing to delete an organization with a live subscription", {
            organizationId: organization.id,
            err: error,
          });
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        }
        throw error;
      }

      /* Read the membership before the delete cascades it away. */
      const members = await ctx.db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, organization.id));

      await ctx.db
        .delete(organizations)
        .where(eq(organizations.id, organization.id));

      /* Each former member lands on another workspace of theirs, or back in
         personal mode — the same repointing `leave` does, applied to everyone
         at once. */
      for (const member of members) {
        const [user] = await ctx.db
          .select({ activeOrganizationId: users.activeOrganizationId })
          .from(users)
          .where(eq(users.id, member.userId))
          .limit(1);

        if (user?.activeOrganizationId !== organization.id) continue;

        const [nextMembership] = await ctx.db
          .select({ organizationId: organizationMembers.organizationId })
          .from(organizationMembers)
          .where(eq(organizationMembers.userId, member.userId))
          .limit(1);

        await ctx.db
          .update(users)
          .set(
            nextMembership
              ? { activeOrganizationId: nextMembership.organizationId }
              : { usageMode: "personal", activeOrganizationId: null },
          )
          .where(eq(users.id, member.userId));
      }

      return { success: true, name: organization.name };
    }),

  updateMemberPermissions: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        userId: z.string(),
        canAddMembers: z.boolean(),
        canAssignTasks: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // SECURITY: Verify the caller is an admin with canManageRoles permission
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin" || !caller.canManageRoles) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to update member permissions",
        });
      }

      // SECURITY: Prevent users from modifying their own permissions
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot modify your own permissions",
        });
      }

      // Update the member's permissions
      await ctx.db
        .update(organizationMembers)
        .set({
          canAddMembers: input.canAddMembers,
          canAssignTasks: input.canAssignTasks,
        })
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, input.userId)
          )
        );

      return { success: true };
    }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        userId: z.string(),
        // Every value of `org_role`. `worker` is the access-code join flow's name
        // for `member` and `mentor` is the view-only role the UI surfaces; both
        // were previously unassignable through role management even though the
        // join flow could produce them.
        role: z.enum(ORG_ROLES).optional(),
        // A custom role of this organization. Its flags are read from the row
        // here rather than trusted from the client.
        customRoleId: z.number().int().optional(),
      }).refine((v) => (v.role === undefined) !== (v.customRoleId === undefined), {
        message: "Pass exactly one of role or customRoleId",
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the caller is an admin
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin" || !caller.canManageRoles) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins with role management permission can change member roles",
        });
      }

      // SECURITY: Prevent users from changing their own role
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own role",
        });
      }

      // SECURITY: Verify the target user is actually a member
      const [targetMember] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, input.userId),
          ),
        )
        .limit(1);

      if (!targetMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User is not a member of this organization",
        });
      }

      // The role is a template for the eight permission columns, which are what
      // the server actually authorizes on. This local copy of the templates was
      // one of three definitions in the codebase; `~/lib/permissions` is now the
      // only one.
      let role: OrgRole;
      let displayRole: string | null = null;
      let permissions;
      if (input.customRoleId !== undefined) {
        const [customRole] = await ctx.db
          .select()
          .from(organizationRoles)
          .where(
            and(
              eq(organizationRoles.id, input.customRoleId),
              eq(organizationRoles.organizationId, input.organizationId),
            ),
          )
          .limit(1);
        if (!customRole) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Role not found in this organization" });
        }
        permissions = pickPermissionFlags(customRole);
        role = baseRoleForFlags("member", permissions);
        displayRole = customRole.name;
      } else {
        role = input.role!;
        permissions = flagsForRole(role);
      }

      await ctx.db
        .update(organizationMembers)
        .set({
          role,
          displayRole,
          ...permissions,
        })
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, input.userId),
          ),
        );

      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the caller is an admin with canKickMembers permission
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin" || !caller.canKickMembers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to remove members",
        });
      }

      // SECURITY: Prevent removing yourself
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself. Use the leave action instead.",
        });
      }

      // SECURITY: Verify target user exists in the organization
      const [targetMember] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, input.userId),
          ),
        )
        .limit(1);

      if (!targetMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User is not a member of this organization",
        });
      }

      // SECURITY: Prevent removing the organization creator if they're the only admin
      const [org] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);

      if (org?.createdById === input.userId) {
        const adminCount = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, input.organizationId),
              eq(organizationMembers.role, "admin"),
            ),
          );

        if (adminCount.length === 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the organization creator when they are the only admin",
          });
        }
      }

      // Delete the membership
      await ctx.db
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, input.userId),
          ),
        );

      // If the removed user had this org as active, switch them to personal mode
      const [removedUser] = await ctx.db
        .select({ activeOrganizationId: users.activeOrganizationId })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (removedUser?.activeOrganizationId === input.organizationId) {
        const [nextMembership] = await ctx.db
          .select({ organizationId: organizationMembers.organizationId })
          .from(organizationMembers)
          .where(eq(organizationMembers.userId, input.userId))
          .limit(1);

        if (!nextMembership) {
          await ctx.db
            .update(users)
            .set({ usageMode: "personal", activeOrganizationId: null })
            .where(eq(users.id, input.userId));
        } else {
          await ctx.db
            .update(users)
            .set({ activeOrganizationId: nextMembership.organizationId })
            .where(eq(users.id, input.userId));
        }
      }

      return { success: true };
    }),

  getRoles: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verify the caller is a member
      const [membership] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      const roles = await ctx.db
        .select()
        .from(organizationRoles)
        .where(eq(organizationRoles.organizationId, input.organizationId));

      return roles;
    }),

  createRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        name: z.string().min(1).max(100),
        canAddMembers: z.boolean().default(false),
        canAssignTasks: z.boolean().default(false),
        canCreateProjects: z.boolean().default(false),
        canDeleteTasks: z.boolean().default(false),
        canKickMembers: z.boolean().default(false),
        canManageRoles: z.boolean().default(false),
        canEditProjects: z.boolean().default(false),
        canViewAnalytics: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the caller is an admin
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin" || !caller.canManageRoles) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins with role management permission can create roles",
        });
      }

      await assertRoleNameFree(ctx, input.organizationId, input.name);

      const [role] = await ctx.db
        .insert(organizationRoles)
        .values({
          organizationId: input.organizationId,
          name: input.name.trim(),
          canAddMembers: input.canAddMembers,
          canAssignTasks: input.canAssignTasks,
          canCreateProjects: input.canCreateProjects,
          canDeleteTasks: input.canDeleteTasks,
          canKickMembers: input.canKickMembers,
          canManageRoles: input.canManageRoles,
          canEditProjects: input.canEditProjects,
          canViewAnalytics: input.canViewAnalytics,
        })
        .returning();

      return role;
    }),

  /**
   * Edit a custom role.
   *
   * Members who were given the role keep the flags they were given: a role is a
   * template stamped onto a membership, not a live link to it. Re-assign the
   * role to someone to give them the edited flags.
   */
  updateRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        roleId: z.number(),
        name: z.string().trim().min(1).max(100),
        permissions: permissionFlagsSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin" || !caller.canManageRoles) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins with role management permission can edit roles",
        });
      }

      await assertRoleNameFree(ctx, input.organizationId, input.name, input.roleId);

      const [role] = await ctx.db
        .update(organizationRoles)
        .set({ name: input.name, ...pickPermissionFlags(input.permissions) })
        .where(
          and(
            eq(organizationRoles.id, input.roleId),
            eq(organizationRoles.organizationId, input.organizationId),
          ),
        )
        .returning();

      if (!role) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found in this organization" });
      }

      return role;
    }),

  deleteRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        roleId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the caller is an admin
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin" || !caller.canManageRoles) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins with role management permission can delete roles",
        });
      }

      // Verify the role belongs to this organization
      const [role] = await ctx.db
        .select()
        .from(organizationRoles)
        .where(
          and(
            eq(organizationRoles.id, input.roleId),
            eq(organizationRoles.organizationId, input.organizationId),
          ),
        )
        .limit(1);

      if (!role) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Role not found in this organization",
        });
      }

      await ctx.db
        .delete(organizationRoles)
        .where(eq(organizationRoles.id, input.roleId));

      return { success: true };
    }),

  /**
   * Invite an address with exactly the permissions the inviter ticked.
   *
   * The grant is stored on the invite and written verbatim into the membership
   * when it is accepted. The invitee hears about it twice: an email with a
   * single-use link (sent through Resend, so it reaches Gmail or any other
   * inbox), and an in-app notification if they already have an account.
   */
  inviteMember: protectedProcedure
    .input(
      inviteGrantSchema.extend({
        organizationId: z.number(),
        email: z.string().trim().email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const email = normalizeEmail(input.email);

      // Verify the caller is an admin or has canAddMembers permission
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!caller || !canInvite(caller)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to invite members",
        });
      }

      // Refuses admin invites and flags beyond the caller's own — see
      // `resolveGrant` for why each one is an escalation.
      const grant = resolveGrant(caller, input);

      // Check if the email belongs to someone already in the organization
      const [existingUser] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);

      if (existingUser) {
        const [existingMember] = await ctx.db
          .select({ userId: organizationMembers.userId })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, input.organizationId),
              eq(organizationMembers.userId, existingUser.id),
            ),
          )
          .limit(1);

        if (existingMember) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This user is already a member of this organization",
          });
        }
      }

      // Check for existing pending invite to avoid duplicates
      const [existingInvite] = await ctx.db
        .select({ id: organizationInvites.id })
        .from(organizationInvites)
        .where(
          and(
            eq(organizationInvites.organizationId, input.organizationId),
            inviteEmailIs(email),
            eq(organizationInvites.status, "pending"),
            or(
              isNull(organizationInvites.expiresAt),
              gt(organizationInvites.expiresAt, new Date()),
            ),
          ),
        )
        .limit(1);

      if (existingInvite) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A pending invite already exists for this email",
        });
      }

      // Checked here as well as at acceptance, which is the one that actually
      // guarantees the limit. This one exists so the admin who can do
      // something about it hears about it, at the moment they act, rather than
      // the invitee hitting a wall days later with no idea who to ask.
      //
      // It counts members, not members plus outstanding invitations: a pending
      // invite is not a seat until it is accepted, and reserving one would let a
      // forgotten invitation from last month block a real colleague today.
      await assertSeatAvailable(input.organizationId);

      const token = generateInviteToken();
      const [invite] = await ctx.db
        .insert(organizationInvites)
        .values({
          organizationId: input.organizationId,
          email,
          role: grant.role,
          displayRole: grant.displayRole,
          permissions: grant.permissions,
          acceptTokenHash: hashInviteToken(token),
          invitedById: ctx.session.user.id,
          status: "pending",
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();

      if (!invite) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create invite" });
      }

      const delivery = await deliverInvite(ctx, invite, token, existingUser?.id ?? null);
      return { ...publicInvite(invite), ...delivery };
    }),

  /**
   * Send a pending invite again, with a fresh link.
   *
   * The token is only ever known at the moment it is minted, so "resend" has to
   * mint a new one — which also retires the old link, should the first email
   * have gone somewhere it should not.
   */
  resendInvite: protectedProcedure
    .input(z.object({ organizationId: z.number(), inviteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!caller || !canInvite(caller)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to invite members",
        });
      }

      const token = generateInviteToken();
      const [invite] = await ctx.db
        .update(organizationInvites)
        .set({
          acceptTokenHash: hashInviteToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .where(
          and(
            eq(organizationInvites.id, input.inviteId),
            eq(organizationInvites.organizationId, input.organizationId),
            eq(organizationInvites.status, "pending"),
          ),
        )
        .returning();

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or already processed" });
      }

      const [existingUser] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${normalizeEmail(invite.email)}`)
        .limit(1);

      const delivery = await deliverInvite(ctx, invite, token, existingUser?.id ?? null);
      return { ...publicInvite(invite), ...delivery };
    }),

  getMyInvites: protectedProcedure.query(async ({ ctx }) => {
    // Get current user's email
    const [currentUser] = await ctx.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.session.user.id))
      .limit(1);

    if (!currentUser?.email) return [];

    const invites = await ctx.db
      .select({
        id: organizationInvites.id,
        organizationId: organizationInvites.organizationId,
        role: organizationInvites.role,
        displayRole: organizationInvites.displayRole,
        permissions: organizationInvites.permissions,
        status: organizationInvites.status,
        createdAt: organizationInvites.createdAt,
        orgName: organizations.name,
      })
      .from(organizationInvites)
      .innerJoin(organizations, eq(organizations.id, organizationInvites.organizationId))
      .where(
        and(
          inviteEmailIs(currentUser.email),
          eq(organizationInvites.status, "pending"),
          or(
            isNull(organizationInvites.expiresAt),
            gt(organizationInvites.expiresAt, new Date()),
          ),
        ),
      );

    return invites.map((invite) => ({
      ...invite,
      permissions: storedGrantFlags(invite.permissions, flagsForRole(invite.role)),
    }));
  }),

  acceptInvite: protectedProcedure
    .input(z.object({ inviteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [currentUser] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      if (!currentUser?.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No email on account" });
      }

      const [invite] = await ctx.db
        .select()
        .from(organizationInvites)
        .where(
          and(
            eq(organizationInvites.id, input.inviteId),
            inviteEmailIs(currentUser.email),
            eq(organizationInvites.status, "pending"),
          ),
        )
        .limit(1);

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or already processed" });
      }

      if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
        await ctx.db
          .update(organizationInvites)
          .set({ status: "expired" })
          .where(eq(organizationInvites.id, invite.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invite has expired" });
      }

      return admitInvite(ctx, invite);
    }),

  /**
   * What an emailed invite link points at, before the invitee commits.
   *
   * The token is the credential, but it is bound to the invited address: the
   * page says whose invite this is so someone signed in as the wrong account
   * knows to switch, and the details stay hidden from them.
   */
  peekInvite: protectedProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .query(async ({ ctx, input }) => {
      await consumeAuthRateLimit(
        createAuthRateLimitKey("org_invite_peek", ctx.session.user.id),
      );

      const [row] = await ctx.db
        .select({
          invite: organizationInvites,
          organizationName: organizations.name,
          inviterName: users.name,
        })
        .from(organizationInvites)
        .innerJoin(organizations, eq(organizations.id, organizationInvites.organizationId))
        .leftJoin(users, eq(users.id, organizationInvites.invitedById))
        .where(eq(organizationInvites.acceptTokenHash, hashInviteToken(input.token)))
        .limit(1);

      if (!row) return { status: "invalid" as const };

      const { invite } = row;
      if (invite.status === "accepted") return { status: "used" as const };
      if (invite.status !== "pending") return { status: "revoked" as const };
      if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
        return { status: "expired" as const };
      }

      const [currentUser] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      if (normalizeEmail(currentUser?.email ?? "") !== normalizeEmail(invite.email)) {
        return {
          status: "wrongAccount" as const,
          invitedEmail: invite.email,
          signedInEmail: currentUser?.email ?? null,
        };
      }

      const [existingMember] = await ctx.db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, invite.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      return {
        status: "valid" as const,
        inviteId: invite.id,
        organizationName: row.organizationName,
        inviterName: row.inviterName,
        role: invite.role,
        displayRole: invite.displayRole,
        permissions: storedGrantFlags(invite.permissions, flagsForRole(invite.role)),
        expiresAt: invite.expiresAt,
        alreadyMember: !!existingMember,
      };
    }),

  /** Accept an invite from its emailed link. Only the invited address may. */
  acceptInviteByToken: protectedProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await consumeAuthRateLimit(
        createAuthRateLimitKey("org_join", ctx.session.user.id),
      );

      const [currentUser] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      if (!currentUser?.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No email on account" });
      }

      const [invite] = await ctx.db
        .select()
        .from(organizationInvites)
        .where(
          and(
            eq(organizationInvites.acceptTokenHash, hashInviteToken(input.token)),
            eq(organizationInvites.status, "pending"),
          ),
        )
        .limit(1);

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This invitation is no longer valid." });
      }

      // Bound to the address it was sent to: a forwarded link, or one read over
      // someone's shoulder, does not admit whoever happens to open it.
      if (normalizeEmail(invite.email) !== normalizeEmail(currentUser.email)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This invitation was sent to a different email address. Sign in with that account to accept it.",
        });
      }

      if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
        await ctx.db
          .update(organizationInvites)
          .set({ status: "expired" })
          .where(eq(organizationInvites.id, invite.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invite has expired" });
      }

      return admitInvite(ctx, invite);
    }),

  declineInvite: protectedProcedure
    .input(z.object({ inviteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [currentUser] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      if (!currentUser?.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No email on account" });
      }

      const [invite] = await ctx.db
        .select()
        .from(organizationInvites)
        .where(
          and(
            eq(organizationInvites.id, input.inviteId),
            inviteEmailIs(currentUser.email),
            eq(organizationInvites.status, "pending"),
            or(
              isNull(organizationInvites.expiresAt),
              gt(organizationInvites.expiresAt, new Date()),
            ),
          ),
        )
        .limit(1);

      if (!invite) {
        const [expiredInvite] = await ctx.db
          .select({ id: organizationInvites.id })
          .from(organizationInvites)
          .where(
            and(
              eq(organizationInvites.id, input.inviteId),
              inviteEmailIs(currentUser.email),
              eq(organizationInvites.status, "pending"),
              lte(organizationInvites.expiresAt, new Date()),
            ),
          )
          .limit(1);

        if (expiredInvite) {
          await ctx.db
            .update(organizationInvites)
            .set({ status: "expired" })
            .where(eq(organizationInvites.id, expiredInvite.id));
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invite has expired" });
        }

        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or already processed" });
      }

      await ctx.db
        .update(organizationInvites)
        .set({ status: "declined" })
        .where(eq(organizationInvites.id, input.inviteId));

      // Notify the person who sent the invite
      if (invite.invitedById) {
        const [decliningUser] = await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ctx.session.user.id))
          .limit(1);
        const declinerName = decliningUser?.name ?? "Someone";

        const [org] = await ctx.db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, invite.organizationId))
          .limit(1);
        const orgName = org?.name ?? "a workspace";

        await notify({
          db: ctx.db,
          userId: invite.invitedById,
          actorId: ctx.session.user.id,
          category: "workspace",
          type: "system",
          title: "Invite Declined",
          message: `${declinerName} declined your invitation to join "${orgName}"`,
          link: "/settings",
        });
      }

      return { success: true };
    }),

  getInvites: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verify the caller is an admin
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can view invites",
        });
      }

      const invites = await ctx.db
        .select()
        .from(organizationInvites)
        .where(
          and(
            eq(organizationInvites.organizationId, input.organizationId),
            eq(organizationInvites.status, "pending"),
            or(
              isNull(organizationInvites.expiresAt),
              gt(organizationInvites.expiresAt, new Date()),
            ),
          ),
        );

      return invites.map(publicInvite);
    }),

  getInviteHistory: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can view invite history",
        });
      }

      const history = await ctx.db
        .select()
        .from(organizationInvites)
        .where(eq(organizationInvites.organizationId, input.organizationId))
        .orderBy(desc(organizationInvites.createdAt))
        .limit(50);
      return history.map(publicInvite);
    }),

  cancelInvite: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        inviteId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the caller is an admin
      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (caller?.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can cancel invites",
        });
      }

      // Verify the invite belongs to this organization
      const [invite] = await ctx.db
        .select()
        .from(organizationInvites)
        .where(
          and(
            eq(organizationInvites.id, input.inviteId),
            eq(organizationInvites.organizationId, input.organizationId),
            eq(organizationInvites.status, "pending"),
            or(
              isNull(organizationInvites.expiresAt),
              gt(organizationInvites.expiresAt, new Date()),
            ),
          ),
        )
        .limit(1);

      if (!invite) {
        const [expiredInvite] = await ctx.db
          .select({ id: organizationInvites.id })
          .from(organizationInvites)
          .where(
            and(
              eq(organizationInvites.id, input.inviteId),
              eq(organizationInvites.organizationId, input.organizationId),
              eq(organizationInvites.status, "pending"),
              lte(organizationInvites.expiresAt, new Date()),
            ),
          )
          .limit(1);

        if (expiredInvite) {
          await ctx.db
            .update(organizationInvites)
            .set({ status: "expired" })
            .where(eq(organizationInvites.id, expiredInvite.id));
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invite has expired" });
        }

        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found or already processed",
        });
      }

      await ctx.db
        .update(organizationInvites)
        .set({ status: "cancelled" })
        .where(eq(organizationInvites.id, input.inviteId));

      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // Join QR codes
  //
  // The permanent `accessCode` is no longer how people get in. A member who may
  // add people mints a short-lived token, the app renders it as a QR, and the
  // token dies on a timer or on first use — so a photograph of the screen is not
  // a standing key to the workspace.
  // ---------------------------------------------------------------------------

  /** The current live QR for an organisation, or null if none is outstanding. */
  getJoinQr: protectedProcedure
    .input(z.object({ organizationId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await requireInviteRights(
        ctx,
        input?.organizationId ?? null,
      );

      const [code] = await ctx.db
        .select()
        .from(organizationJoinCodes)
        .where(
          and(
            eq(organizationJoinCodes.organizationId, membership.organizationId),
            eq(organizationJoinCodes.kind, "qr"),
            isNull(organizationJoinCodes.revokedAt),
            gt(organizationJoinCodes.expiresAt, new Date()),
            sql`${organizationJoinCodes.usedCount} < ${organizationJoinCodes.maxUses}`,
          ),
        )
        .orderBy(desc(organizationJoinCodes.createdAt))
        .limit(1);

      if (!code) return null;

      return describeJoinCode(ctx.headers, code, membership.organizationName);
    }),

  /**
   * Mint a fresh QR, retiring whatever was outstanding.
   *
   * Rotation revokes rather than reuses, so "show the code again" and "let the
   * old scan still work" can never be the same action by accident. It only ever
   * touches QR codes: invite links an admin shared by hand live on.
   */
  rotateJoinQr: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.number().optional(),
          role: z.enum(["worker", "mentor"]).optional(),
          maxUses: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireInviteRights(
        ctx,
        input?.organizationId ?? null,
      );

      await ctx.db
        .update(organizationJoinCodes)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationJoinCodes.organizationId, membership.organizationId),
            eq(organizationJoinCodes.kind, "qr"),
            isNull(organizationJoinCodes.revokedAt),
          ),
        );

      const token = generateJoinToken();
      const [created] = await ctx.db
        .insert(organizationJoinCodes)
        .values({
          organizationId: membership.organizationId,
          code: token,
          kind: "qr",
          role: input?.role ?? "worker",
          createdById: ctx.session.user.id,
          expiresAt: new Date(Date.now() + JOIN_CODE_TTL_MS),
          maxUses: input?.maxUses ?? 1,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create join code",
        });
      }

      return describeJoinCode(ctx.headers, created, membership.organizationName);
    }),

  /** Kill the outstanding QR without minting a replacement. */
  revokeJoinQr: protectedProcedure
    .input(z.object({ organizationId: z.number().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const membership = await requireInviteRights(
        ctx,
        input?.organizationId ?? null,
      );

      await ctx.db
        .update(organizationJoinCodes)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationJoinCodes.organizationId, membership.organizationId),
            eq(organizationJoinCodes.kind, "qr"),
            isNull(organizationJoinCodes.revokedAt),
          ),
        );

      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // Invite links
  //
  // A link (and the code inside it) that an admin configures by hand — which
  // role, which of the eight flags, how many people, for how long — and shares
  // however they like. Whoever redeems it gets exactly that grant.
  // ---------------------------------------------------------------------------

  createInviteLink: protectedProcedure
    .input(
      inviteGrantSchema.extend({
        organizationId: z.number(),
        maxUses: z.number().int().min(1).max(100).default(1),
        expiresInDays: z
          .number()
          .int()
          .min(1)
          .max(INVITE_LINK_MAX_DAYS)
          .default(INVITE_LINK_DEFAULT_DAYS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireInviteRights(ctx, input.organizationId);

      const [caller] = await ctx.db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!caller) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
      }

      const grant = resolveGrant(caller, input);

      const [created] = await ctx.db
        .insert(organizationJoinCodes)
        .values({
          organizationId: membership.organizationId,
          code: generateJoinToken(),
          kind: "link",
          role: grant.role,
          displayRole: grant.displayRole,
          permissions: grant.permissions,
          createdById: ctx.session.user.id,
          expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
          maxUses: input.maxUses,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create invite link",
        });
      }

      return describeInviteLink(ctx.headers, created);
    }),

  /** Invite links that can still be redeemed. */
  listInviteLinks: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireInviteRights(ctx, input.organizationId);

      const links = await ctx.db
        .select()
        .from(organizationJoinCodes)
        .where(
          and(
            eq(organizationJoinCodes.organizationId, input.organizationId),
            eq(organizationJoinCodes.kind, "link"),
            isNull(organizationJoinCodes.revokedAt),
            gt(organizationJoinCodes.expiresAt, new Date()),
            sql`${organizationJoinCodes.usedCount} < ${organizationJoinCodes.maxUses}`,
          ),
        )
        .orderBy(desc(organizationJoinCodes.createdAt));

      return links.map((link) => describeInviteLink(ctx.headers, link));
    }),

  revokeInviteLink: protectedProcedure
    .input(z.object({ organizationId: z.number(), linkId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireInviteRights(ctx, input.organizationId);

      const revoked = await ctx.db
        .update(organizationJoinCodes)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationJoinCodes.id, input.linkId),
            eq(organizationJoinCodes.organizationId, input.organizationId),
            eq(organizationJoinCodes.kind, "link"),
            isNull(organizationJoinCodes.revokedAt),
          ),
        )
        .returning({ id: organizationJoinCodes.id });

      if (revoked.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite link not found or already revoked" });
      }

      return { success: true };
    }),

  /**
   * What a scanned or shared token points at, before the holder commits to
   * joining.
   *
   * Deliberately says only whether the token is usable and, if so, which
   * organisation it opens and with what — never why a bad token is bad beyond a
   * coarse reason, so this cannot be used to probe which tokens once existed.
   */
  peekJoinQr: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      await consumeAuthRateLimit(
        createAuthRateLimitKey("org_join_peek", ctx.session.user.id),
      );

      const [row] = await ctx.db
        .select({
          joinCode: organizationJoinCodes,
          organizationName: organizations.name,
        })
        .from(organizationJoinCodes)
        .innerJoin(
          organizations,
          eq(organizationJoinCodes.organizationId, organizations.id),
        )
        .where(eq(organizationJoinCodes.code, input.code.trim().toUpperCase()))
        .limit(1);

      if (!row) return { status: "invalid" as const };

      const { joinCode } = row;
      if (joinCode.revokedAt) return { status: "revoked" as const };
      if (joinCode.expiresAt.getTime() <= Date.now()) {
        return { status: "expired" as const };
      }
      if (joinCode.usedCount >= joinCode.maxUses) {
        return { status: "used" as const };
      }

      const [existingMember] = await ctx.db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, joinCode.organizationId),
            eq(organizationMembers.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      const grant = joinCodeGrant(joinCode);
      return {
        status: "valid" as const,
        kind: joinCode.kind,
        organizationId: joinCode.organizationId,
        organizationName: row.organizationName,
        role: grant.role,
        displayRole: grant.displayRole,
        permissions: grant.permissions,
        expiresAt: joinCode.expiresAt,
        alreadyMember: !!existingMember,
      };
    }),

  /** Redeem a scanned QR or a shared invite link. */
  joinWithQr: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      // Same reasoning as `join`: this endpoint says whether a guess was right,
      // so it is an enumeration oracle without a limit on both the caller and
      // the source address.
      await consumeAuthRateLimit(
        createAuthRateLimitKey("org_join", ctx.session.user.id),
      );
      await consumeAuthRateLimit(
        createAuthRateLimitKey("org_join_ip", getClientIp(ctx.headers)),
      );

      return redeemJoinCode(ctx, input.code);
    }),
});
