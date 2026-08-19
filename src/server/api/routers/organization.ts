
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { organizations, organizationMembers, organizationRoles, organizationInvites, users, notifications } from "~/server/db/schema";
import { flagsForRole } from "~/lib/permissions";
import { consumeAuthRateLimit, createAuthRateLimitKey } from "~/server/authRateLimit";
import { getClientIp } from "~/server/clientIp";

/**
 * The access code is a bearer credential: anyone holding it can join the
 * organization, permanently. Returning it to every member — including `guest` and
 * the view-only `mentor` — let any member hand out standing access to the whole
 * workspace. Only members who can actually add people should see it.
 */
function canSeeAccessCode(membership: {
  role: string;
  canAddMembers?: boolean;
}): boolean {
  return membership.role === "admin" || membership.canAddMembers === true;
}
import { eq, and, or, isNull, gt, lte, desc } from "drizzle-orm";
import { emitNotification } from "~/server/socket/emit";
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
      accessCode: canSeeAccessCode(m) ? m.organization.accessCode : null,
      role: m.role,
      joinedAt: m.joinedAt,
      createdAt: m.organization.createdAt,
    }));
  }),

  getActive: protectedProcedure.query(async ({ ctx }) => {
    let activeOrganizationId: number | null = null;

    try {
      const user = await ctx.db
        .select({
          activeOrganizationId: users.activeOrganizationId,
        })
        .from(users)
        .where(eq(users.id, ctx.session.user.id))
        .limit(1);

      activeOrganizationId = user[0]?.activeOrganizationId ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("active_organization_id")) {
        throw err;
      }
      // Backwards-compat: DB may not have been migrated yet.
      activeOrganizationId = null;
    }

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
            accessCode: canSeeAccessCode(membership)
              ? membership.organization.accessCode
              : null,
          },
          role: membership.role,
        };
      }
    }

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
      .limit(1);

    if (!fallback) return null;

    return {
      organization: {
        id: fallback.organization.id,
        name: fallback.organization.name,
        accessCode: canSeeAccessCode(fallback)
          ? fallback.organization.accessCode
          : null,
      },
      role: fallback.role,
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
          const [notif] = await ctx.db.insert(notifications).values({
            userId: admin.userId,
            type: "system",
            title: "New Member Joined",
            message: `${joinerName} joined "${organization.name}" via access code`,
            link: "/settings",
            read: false,
          }).returning();

          if (notif) {
            emitNotification(admin.userId, {
              id: notif.id,
              type: "system",
              title: "New Member Joined",
              message: `${joinerName} joined "${organization.name}" via access code`,
              link: "/settings",
            });
          }
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

        const [createdNotification] = await ctx.db.insert(notifications).values({
          userId: existingUser.id,
          type: "system",
          title: "Workspace Invitation",
          message: `${inviterName} invited you to join "${orgName}" as ${input.role}`,
          link: "/orgs",
          read: false,
        }).returning();

        if (createdNotification) {
          emitNotification(existingUser.id, {
            id: createdNotification.id,
            type: "system",
            title: "Workspace Invitation",
            message: `${inviterName} invited you to join "${orgName}" as ${input.role}`,
            link: "/orgs",
          });
        }
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
        const [notif] = await ctx.db.insert(notifications).values({
          userId: invite.invitedById,
          type: "system",
          title: "Invite Accepted",
          message: `${acceptorName} accepted your invitation to join "${orgName}"`,
          link: "/settings",
          read: false,
        }).returning();

        if (notif) {
          emitNotification(invite.invitedById, {
            id: notif.id,
            type: "system",
            title: "Invite Accepted",
            message: `${acceptorName} accepted your invitation to join "${orgName}"`,
            link: "/settings",
          });
        }
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

        const [notif] = await ctx.db.insert(notifications).values({
          userId: invite.invitedById,
          type: "system",
          title: "Invite Declined",
          message: `${declinerName} declined your invitation to join "${orgName}"`,
          link: "/settings",
          read: false,
        }).returning();

        if (notif) {
          emitNotification(invite.invitedById, {
            id: notif.id,
            type: "system",
            title: "Invite Declined",
            message: `${declinerName} declined your invitation to join "${orgName}"`,
            link: "/settings",
          });
        }
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
});
