import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { organizations, organizationMembers, users } from "~/server/db/schema";
import { eq } from "drizzle-orm";

export const userRouter = createTRPCRouter({
  
  getCurrentUser: protectedProcedure
    .query(async ({ ctx }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
          bio: true,
          createdAt: true, 
        },
      });

      return user ?? null;
    }),

  
  setPersonalMode: protectedProcedure
    .mutation(async ({ ctx }) => {
      await ctx.db.update(users)
        .set({ usageMode: "personal", activeOrganizationId: null })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),

  
  getProfile: protectedProcedure
    .query(async ({ ctx }) => {
      let user:
        | {
            id: string;
            usageMode: (typeof users.$inferSelect)["usageMode"];
            activeOrganizationId: number | null;
            name: string | null;
            email: string;
            bio: string | null;
            image: string | null;
            createdAt: Date;
          }
        | null = null;

      try {
        user =
          (await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.session.user.id),
          columns: {
            id: true,
            usageMode: true,
            activeOrganizationId: true,
            name: true,
            email: true,
            bio: true,
            image: true,
            createdAt: true,
          },
        })) ?? null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Backwards-compat: DB may not have been migrated yet.
        if (message.includes("active_organization_id")) {
          const fallback = await ctx.db.query.users.findFirst({
            where: eq(users.id, ctx.session.user.id),
            columns: {
              id: true,
              usageMode: true,
              name: true,
              email: true,
              bio: true,
              image: true,
              createdAt: true,
            },
          });

          if (!fallback) {
            user = null;
          } else {
            user = {
              ...fallback,
              activeOrganizationId: null,
            };
          }
        } else {
          throw err;
        }
      }

      if (!user) {
        return null;
      }

      const memberships = await ctx.db
        .select({
          organization: organizations,
          role: organizationMembers.role,
          joinedAt: organizationMembers.joinedAt,
          // The eight permission columns are the source of truth for
          // authorization (see `~/lib/permissions`). Returning them lets the
          // client render from the same values the server authorizes on, rather
          // than re-deriving them from the role and drifting when an admin has
          // adjusted an individual flag.
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
        .innerJoin(
          organizations,
          eq(organizationMembers.organizationId, organizations.id),
        )
        .where(eq(organizationMembers.userId, ctx.session.user.id));

      const activeMembership = user.activeOrganizationId
        ? memberships.find((m) => m.organization.id === user.activeOrganizationId) ?? null
        : memberships[0] ?? null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        bio: user.bio,
        image: user.image,
        createdAt: user.createdAt,
        usageMode: user.usageMode,
        activeOrganizationId: user.activeOrganizationId,
        organizations: memberships.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          accessCode: m.organization.accessCode,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
        organization: activeMembership?.organization ?? null,
        role: activeMembership?.role ?? null,
        permissions: activeMembership
          ? {
              canAddMembers: activeMembership.canAddMembers,
              canAssignTasks: activeMembership.canAssignTasks,
              canCreateProjects: activeMembership.canCreateProjects,
              canDeleteTasks: activeMembership.canDeleteTasks,
              canKickMembers: activeMembership.canKickMembers,
              canManageRoles: activeMembership.canManageRoles,
              canEditProjects: activeMembership.canEditProjects,
              canViewAnalytics: activeMembership.canViewAnalytics,
            }
          : null,
      };
    }),


  checkOnboardingStatus: protectedProcedure
    .query(async ({ ctx }) => {
      let user:
        | {
            usageMode: (typeof users.$inferSelect)["usageMode"];
            activeOrganizationId: number | null;
            organizationMemberships: unknown[];
          }
        | null = null;

      try {
        user =
          (await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.session.user.id),
          columns: {
            usageMode: true,
            activeOrganizationId: true,
          },
          with: {
            organizationMemberships: {
              limit: 1,
            },
          },
        })) ?? null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("active_organization_id")) {
          const fallback = await ctx.db.query.users.findFirst({
            where: eq(users.id, ctx.session.user.id),
            columns: {
              usageMode: true,
            },
            with: {
              organizationMemberships: {
                limit: 1,
              },
            },
          });

          if (!fallback) {
            user = null;
          } else {
            user = {
              ...fallback,
              activeOrganizationId: null,
            };
          }
        } else {
          throw err;
        }
      }

      return {
        needsOnboarding: !user?.usageMode,
        usageMode: user?.usageMode,
        hasOrganization: (user?.organizationMemberships?.length ?? 0) > 0,
        activeOrganizationId: user?.activeOrganizationId ?? null,
      };
    }),


  uploadProfileImage: protectedProcedure
    .input(
      z.object({
        image: z.string().url(),
        filename: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      
      await new Promise((resolve) => setTimeout(resolve, 500));

      await ctx.db.update(users)
        .set({ image: input.image })
        .where(eq(users.id, ctx.session.user.id));

      return {
        success: true,
        imageUrl: input.image,
      };
    }),

    searchByEmail: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      return user ?? null;
    }),
});