
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, type TRPCContext } from "~/server/api/trpc";
import { organizations, organizationMembers, organizationRoles, organizationInvites, organizationJoinCodes, users, type OrganizationJoinCode } from "~/server/db/schema";
import { flagsForRole } from "~/lib/permissions";
import { consumeAuthRateLimit, createAuthRateLimitKey } from "~/server/security/authRateLimit";
import { getClientIp } from "~/server/http/clientIp";
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
      },
      role: fallback.role,
      canInvite: canInvite(fallback),
    };
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
          .where(eq(organizations.accessCode, input.code.toUpperCase()));

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


  getMy: protectedProcedure.query(async ({ ctx }) => {
    let activeOrganizationId: number | null = null;

    try {
      const user = await ctx.db
        .select({ activeOrganizationId: users.activeOrganizationId })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      activeOrganizationId = user[0]?.activeOrganizationId ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("active_organization_id")) {
        throw err;
      }
      activeOrganizationId = null;
    }

    const [membership] = await ctx.db
      .select({
        organization: organizations,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(
        activeOrganizationId
          ? and(
              eq(organizationMembers.userId, ctx.session.user.id),
              eq(organizationMembers.organizationId, activeOrganizationId),
            )
          : eq(organizationMembers.userId, ctx.session.user.id),
      )
      .limit(1);

    if (!membership) return null;

    return {
      id: membership.organization.id,
      name: membership.organization.name,
      accessCode: membership.organization.accessCode,
      role: membership.role,
      createdAt: membership.organization.createdAt,
    };
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
          joinedAt: organizationMembers.joinedAt,
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
        role: z.enum(["admin", "member", "guest", "worker", "mentor"]),
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
      const permissions = flagsForRole(input.role);

      await ctx.db
        .update(organizationMembers)
        .set({
          role: input.role,
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

      const [role] = await ctx.db
        .insert(organizationRoles)
        .values({
          organizationId: input.organizationId,
          name: input.name,
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

  inviteMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        email: z.string().email(),
        role: z.string().min(1).default("member"),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

      if (!caller || (caller.role !== "admin" && !caller.canAddMembers)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to invite members",
        });
      }

      // Check if the email belongs to someone already in the organization
      const [existingUser] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
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
            eq(organizationInvites.email, input.email),
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

      // Map custom role names to a valid DB enum value
      const validRoles = ["admin", "member", "guest", "worker", "mentor"] as const;
      type ValidRole = typeof validRoles[number];
      const dbRole: ValidRole = validRoles.includes(input.role as ValidRole)
        ? (input.role as ValidRole)
        : "member";

      // SECURITY: inviting an admin is role management, not member management.
      // The caller check above admits any member holding `canAddMembers`, so
      // without this a delegated inviter could invite an address they control as
      // "admin" and escalate to full org control. Mirrors the guard in
      // `updateMemberRole`.
      if (dbRole === "admin" && !(caller.role === "admin" && caller.canManageRoles)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins with role management permission can invite admins",
        });
      }

      const [invite] = await ctx.db
        .insert(organizationInvites)
        .values({
          organizationId: input.organizationId,
          email: input.email,
          role: dbRole,
          displayRole: input.role !== dbRole ? input.role : null,
          invitedById: ctx.session.user.id,
          status: "pending",
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();

      // Notify the invited user (if they have an account)
      if (existingUser) {
        const [org] = await ctx.db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))
          .limit(1);

        const inviterUser = await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.session.user.id),
          columns: { name: true },
        });
        const inviterName = inviterUser?.name ?? "Someone";
        const orgName = org?.name ?? "a workspace";

        await notify({
          db: ctx.db,
          userId: existingUser.id,
          actorId: ctx.session.user.id,
          category: "invite",
          type: "system",
          title: "Workspace Invitation",
          message: `${inviterName} invited you to join "${orgName}" as ${input.role}`,
          link: "/orgs",
        });
      }

      return invite;
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
        status: organizationInvites.status,
        createdAt: organizationInvites.createdAt,
        orgName: organizations.name,
      })
      .from(organizationInvites)
      .innerJoin(organizations, eq(organizations.id, organizationInvites.organizationId))
      .where(
        and(
          eq(organizationInvites.email, currentUser.email),
          eq(organizationInvites.status, "pending"),
          or(
            isNull(organizationInvites.expiresAt),
            gt(organizationInvites.expiresAt, new Date()),
          ),
        ),
      );

    return invites;
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
            eq(organizationInvites.email, currentUser.email),
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
              eq(organizationInvites.email, currentUser.email),
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

      // Check not already a member
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

      if (existingMember) {
        // Mark invite as accepted and return
        await ctx.db
          .update(organizationInvites)
          .set({ status: "accepted" })
          .where(eq(organizationInvites.id, input.inviteId));
        return { success: true, alreadyMember: true };
      }

      // Add as member
      const invitedRole = invite.role ?? "member";
      await ctx.db.insert(organizationMembers).values({
        organizationId: invite.organizationId,
        userId: ctx.session.user.id,
        role: invitedRole,
        ...flagsForRole(invitedRole),
      });

      // Mark invite as accepted
      await ctx.db
        .update(organizationInvites)
        .set({ status: "accepted" })
        .where(eq(organizationInvites.id, input.inviteId));

      // Switch to this org
      await ctx.db
        .update(users)
        .set({ usageMode: "organization", activeOrganizationId: invite.organizationId })
        .where(eq(users.id, ctx.session.user.id));

      const [org] = await ctx.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, invite.organizationId))
        .limit(1);

      const orgName = org?.name ?? "Workspace";

      // Get the current user's name for the notification
      const [acceptingUser] = await ctx.db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);
      const acceptorName = acceptingUser?.name ?? "Someone";

      // Notify the person who sent the invite
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

      return { success: true, organizationName: orgName };
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
            eq(organizationInvites.email, currentUser.email),
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
              eq(organizationInvites.email, currentUser.email),
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

      return invites;
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

      return await ctx.db
        .select()
        .from(organizationInvites)
        .where(eq(organizationInvites.organizationId, input.organizationId))
        .orderBy(desc(organizationInvites.createdAt))
        .limit(50);
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
   * old scan still work" can never be the same action by accident.
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
            isNull(organizationJoinCodes.revokedAt),
          ),
        );

      const token = generateJoinToken();
      const [created] = await ctx.db
        .insert(organizationJoinCodes)
        .values({
          organizationId: membership.organizationId,
          code: token,
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
            isNull(organizationJoinCodes.revokedAt),
          ),
        );

      return { success: true };
    }),

  /**
   * What a scanned token points at, before the scanner commits to joining.
   *
   * Deliberately says only whether the token is usable and, if so, which
   * organisation it opens — never why a bad token is bad beyond a coarse reason,
   * so this cannot be used to probe which tokens once existed.
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
        .where(eq(organizationJoinCodes.code, input.code.toUpperCase()))
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

      return {
        status: "valid" as const,
        organizationId: joinCode.organizationId,
        organizationName: row.organizationName,
        role: joinCode.role,
        expiresAt: joinCode.expiresAt,
        alreadyMember: !!existingMember,
      };
    }),

  /** Redeem a scanned token. */
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

      const code = input.code.toUpperCase();

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
          message: "This invite code is no longer valid. Ask for a fresh QR code.",
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

      // Claim a use with a conditional update rather than a read-then-write, so
      // two people scanning the same single-use QR at once cannot both win.
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
          message: "This invite code is no longer valid. Ask for a fresh QR code.",
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

      const joinRole = candidate.role === "mentor" ? "mentor" : "worker";

      try {
        await ctx.db.insert(organizationMembers).values({
          organizationId: organization.id,
          userId: ctx.session.user.id,
          role: joinRole,
          ...flagsForRole(joinRole),
        });
      } catch (error) {
        // Hand the use back so a failed insert does not burn a single-use QR.
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

      for (const admin of orgAdmins) {
        if (admin.userId === ctx.session.user.id) continue;
        const message = `${joinerName} joined "${organization.name}" by scanning an invite QR`;
        await notify({
          db: ctx.db,
          userId: admin.userId,
          actorId: ctx.session.user.id,
          category: "workspace",
          type: "system",
          title: "New Member Joined",
          message,
          link: "/settings?section=workspace",
        });
      }

      return {
        success: true,
        organizationId: organization.id,
        organizationName: organization.name,
        role: joinRole,
      };
    }),
});
