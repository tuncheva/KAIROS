import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, type TRPCContext } from "~/server/api/trpc";
import {
  directConversations,
  directMessages,
  notifications,
  organizationMembers,
  projectCollaborators,
  projects,
  users,
} from "~/server/db/schema";
import { and, asc, desc, eq, inArray, lt, or, sql, isNull } from "drizzle-orm";
import { emitNewMessage, emitConversationUpdated, emitNotification } from "~/server/ws/emit";

async function assertProjectAccess(ctx: TRPCContext, projectId: number) {
  if (!ctx.session?.user?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

  const [project] = await ctx.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

  const userId: string = ctx.session.user.id;
  const isOwner = project.createdById === userId;

  let isOrgMember = false;
  if (project.organizationId) {
    const [membership] = await ctx.db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, project.organizationId), eq(organizationMembers.userId, userId)))
      .limit(1);
    isOrgMember = !!membership;
  }

  if (isOwner || isOrgMember) return project;

  const [collaboration] = await ctx.db
    .select()
    .from(projectCollaborators)
    .where(and(eq(projectCollaborators.projectId, projectId), eq(projectCollaborators.collaboratorId, userId)))
    .limit(1);

  if (!collaboration) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this project" });
  return project;
}

function normalizePair(a: string, b: string): { userOneId: string; userTwoId: string } {
  return a < b ? { userOneId: a, userTwoId: b } : { userOneId: b, userTwoId: a };
}

export const chatRouter = createTRPCRouter({
  getParticipantSuggestions: protectedProcedure
    .query(async ({ ctx }) => {
      const selfId: string = ctx.session.user.id;

      let activeOrganizationId: number | null = null;
      const [selfUser] = await ctx.db
        .select({ activeOrganizationId: users.activeOrganizationId })
        .from(users)
        .where(eq(users.id, selfId))
        .limit(1);
      activeOrganizationId = selfUser?.activeOrganizationId ?? null;

      const orgMembers = activeOrganizationId
        ? await ctx.db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              image: users.image,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(eq(organizationMembers.organizationId, activeOrganizationId))
            .orderBy(asc(users.name))
        : [];

      const memberships = await ctx.db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, selfId));
      const orgIds = memberships.map((m) => m.organizationId);

      const userProjects = orgIds.length
        ? await ctx.db
            .select({ id: projects.id, title: projects.title, createdById: projects.createdById })
            .from(projects)
            .where(
              or(
                inArray(projects.organizationId, orgIds),
                eq(projects.createdById, selfId),
              ),
            )
        : await ctx.db
            .select({ id: projects.id, title: projects.title, createdById: projects.createdById })
            .from(projects)
            .where(eq(projects.createdById, selfId));

      const projectIds = userProjects.map((p) => p.id);
      const projectCollaboratorRows = projectIds.length
        ? await ctx.db
            .select({
              projectId: projectCollaborators.projectId,
              id: users.id,
              name: users.name,
              email: users.email,
              image: users.image,
            })
            .from(projectCollaborators)
            .innerJoin(users, eq(users.id, projectCollaborators.collaboratorId))
            .where(inArray(projectCollaborators.projectId, projectIds))
        : [];
      const ownerIds = Array.from(new Set(userProjects.map((p) => p.createdById).filter((id) => id !== selfId)));
      const projectOwners = ownerIds.length
        ? await ctx.db
            .select({ id: users.id, name: users.name, email: users.email, image: users.image })
            .from(users)
            .where(inArray(users.id, ownerIds))
        : [];
      const ownersById = new Map(projectOwners.map((o) => [o.id, o] as const));

      const allConversationRows = await ctx.db
        .select({
          id: directConversations.id,
          userOneId: directConversations.userOneId,
          userTwoId: directConversations.userTwoId,
          lastMessageAt: directConversations.lastMessageAt,
          projectId: directConversations.projectId,
        })
        .from(directConversations)
        .where(or(eq(directConversations.userOneId, selfId), eq(directConversations.userTwoId, selfId)))
        .orderBy(desc(directConversations.lastMessageAt));

      const projectMembersMap = new Map<number, Array<{ id: string; name: string | null; email: string | null; image: string | null }>>();
      for (const project of userProjects) {
        projectMembersMap.set(project.id, []);
      }
      for (const row of projectCollaboratorRows) {
        const list = projectMembersMap.get(row.projectId) ?? [];
        list.push({ id: row.id, name: row.name, email: row.email, image: row.image });
        projectMembersMap.set(row.projectId, list);
      }
      for (const project of userProjects) {
        const list = projectMembersMap.get(project.id) ?? [];
        if (project.createdById !== selfId && !list.some((m) => m.id === project.createdById)) {
          const owner = ownersById.get(project.createdById);
          if (owner) list.push(owner);
          projectMembersMap.set(project.id, list);
        }
      }

      const recentByUser = new Map<string, { id: string; name: string | null; email: string | null; image: string | null; lastMessageAt: Date | null }>();
      const convoUserIds = new Set<string>();
      for (const c of allConversationRows) {
        convoUserIds.add(c.userOneId);
        convoUserIds.add(c.userTwoId);
      }
      convoUserIds.delete(selfId);
      const convoUsers = convoUserIds.size
        ? await ctx.db
            .select({ id: users.id, name: users.name, email: users.email, image: users.image })
            .from(users)
            .where(inArray(users.id, Array.from(convoUserIds)))
        : [];
      const convoUserMap = new Map(convoUsers.map((u) => [u.id, u] as const));
      for (const convo of allConversationRows) {
        const otherUserId = convo.userOneId === selfId ? convo.userTwoId : convo.userOneId;
        const other = convoUserMap.get(otherUserId);
        if (!other) continue;
        const prev = recentByUser.get(otherUserId);
        const nextTs = convo.lastMessageAt?.getTime() ?? 0;
        const prevTs = prev?.lastMessageAt?.getTime() ?? 0;
        if (!prev || nextTs > prevTs) {
          recentByUser.set(otherUserId, {
            id: other.id,
            name: other.name,
            email: other.email,
            image: other.image,
            lastMessageAt: convo.lastMessageAt,
          });
        }
      }

      const sortByName = (a: { name: string | null; email: string | null }, b: { name: string | null; email: string | null }) =>
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", undefined, { sensitivity: "base" });

      const uniqueOrgMembers = orgMembers
        .filter((m) => m.id !== selfId)
        .sort(sortByName);
      const uniqueRecentContacts = Array.from(recentByUser.values())
        .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
        .map(({ lastMessageAt: _ts, ...u }) => u);
      const projectSuggestions = userProjects
        .map((p) => ({
          projectId: p.id,
          projectTitle: p.title,
          members: Array.from(
            new Map(
              (projectMembersMap.get(p.id) ?? [])
                .filter((m) => m.id !== selfId)
                .map((m) => [m.id, m] as const),
            ).values(),
          ).sort(sortByName),
        }))
        .filter((p) => p.members.length > 0)
        .slice(0, 12);

      return {
        organizationMembers: uniqueOrgMembers,
        recentContacts: uniqueRecentContacts.slice(0, 12),
        projectSuggestions,
      };
    }),

  listProjectUsers: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await assertProjectAccess(ctx, input.projectId);
      const selfId: string = ctx.session.user.id;

      if (project.organizationId) {
        const members = await ctx.db
          .select({
            id: users.id,
            name: users.name,
            image: users.image,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(eq(organizationMembers.organizationId, project.organizationId))
          .orderBy(asc(users.name));

        return members.filter((m: { id: string }) => m.id !== selfId);
      }

      const collaborators = await ctx.db
        .select({ collaboratorId: projectCollaborators.collaboratorId })
        .from(projectCollaborators)
        .where(eq(projectCollaborators.projectId, input.projectId));

      const ids = Array.from(
        new Set([
          project.createdById,
          ...collaborators.map((c: { collaboratorId: string }) => c.collaboratorId),
        ]),
      ).filter((id) => id !== selfId);

      if (ids.length === 0) return [];

      return ctx.db
        .select({ id: users.id, name: users.name, image: users.image })
        .from(users)
        .where(inArray(users.id, ids));
    }),

  getOrCreateProjectConversation: protectedProcedure
    .input(z.object({ projectId: z.number(), otherUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const project = await assertProjectAccess(ctx, input.projectId);
      const selfId: string = ctx.session.user.id;
      if (input.otherUserId === selfId) throw new TRPCError({ code: "BAD_REQUEST", message: "Can't start a chat with yourself" });

      // Verify the other user can access the project too.
      if (project.organizationId) {
        const [membership] = await ctx.db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, project.organizationId),
              eq(organizationMembers.userId, input.otherUserId),
            ),
          )
          .limit(1);
        if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "That user is not in this organization" });
      } else {
        const allowedIds = new Set<string>();
        allowedIds.add(project.createdById);
        const collaborators = await ctx.db
          .select({ collaboratorId: projectCollaborators.collaboratorId })
          .from(projectCollaborators)
          .where(eq(projectCollaborators.projectId, input.projectId));
        for (const c of collaborators as Array<{ collaboratorId: string }>) allowedIds.add(c.collaboratorId);
        if (!allowedIds.has(input.otherUserId)) throw new TRPCError({ code: "FORBIDDEN", message: "That user doesn't have access to this project" });
      }

      const { userOneId, userTwoId } = normalizePair(selfId, input.otherUserId);

      const [existing] = await ctx.db
        .select({ id: directConversations.id })
        .from(directConversations)
        .where(
          and(
            eq(directConversations.projectId, input.projectId),
            eq(directConversations.userOneId, userOneId),
            eq(directConversations.userTwoId, userTwoId),
          ),
        )
        .limit(1);

      if (existing) return { conversationId: existing.id };

      const [created] = await ctx.db
        .insert(directConversations)
        .values({
          projectId: input.projectId,
          organizationId: project.organizationId ?? null,
          userOneId,
          userTwoId,
          lastMessageAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .returning({ id: directConversations.id });

      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create conversation" });
      return { conversationId: created.id };
    }),

  listMessages: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      cursor: z.number().optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const selfId: string = ctx.session.user.id;

      const [convo] = await ctx.db
        .select({
          id: directConversations.id,
          userOneId: directConversations.userOneId,
          userTwoId: directConversations.userTwoId,
        })
        .from(directConversations)
        .where(eq(directConversations.id, input.conversationId))
        .limit(1);

      if (!convo) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      if (convo.userOneId !== selfId && convo.userTwoId !== selfId) throw new TRPCError({ code: "FORBIDDEN" });

      const conditions = [eq(directMessages.conversationId, input.conversationId)];
      if (input.cursor) {
        conditions.push(lt(directMessages.id, input.cursor));
      }

      const rows = await ctx.db
        .select({
          id: directMessages.id,
          body: directMessages.body,
          createdAt: directMessages.createdAt,
          senderId: directMessages.senderId,
          senderName: users.name,
          senderImage: users.image,
        })
        .from(directMessages)
        .innerJoin(users, eq(users.id, directMessages.senderId))
        .where(and(...conditions))
        .orderBy(desc(directMessages.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      if (hasMore) rows.pop();

      /* The page is selected newest-first and then reversed, so `messages` runs
         oldest -> newest and `rows[0]` is the oldest row on it. The cursor
         therefore walks *backwards* in time: it is the anchor for the page
         BEFORE this one, which is why it is named `prevCursor` and why callers
         must page with `getPreviousPageParam`/`fetchPreviousPage`.

         Naming it `nextCursor` is what led both chat clients to fetch older
         pages with `fetchNextPage`, which appends them after the newest page —
         history rendered below the latest message instead of above it. */
      return {
        messages: rows.reverse(),
        prevCursor: hasMore ? rows[0]?.id : undefined,
      };
    }),

  sendMessage: protectedProcedure
    .input(z.object({ conversationId: z.number(), body: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const selfId: string = ctx.session.user.id;

      const [convo] = await ctx.db
        .select({
          id: directConversations.id,
          userOneId: directConversations.userOneId,
          userTwoId: directConversations.userTwoId,
        })
        .from(directConversations)
        .where(eq(directConversations.id, input.conversationId))
        .limit(1);

      if (!convo) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      if (convo.userOneId !== selfId && convo.userTwoId !== selfId) throw new TRPCError({ code: "FORBIDDEN" });

      const [message] = await ctx.db
        .insert(directMessages)
        .values({
          conversationId: input.conversationId,
          senderId: selfId,
          body: input.body,
        })
        .returning({
          id: directMessages.id,
          body: directMessages.body,
          createdAt: directMessages.createdAt,
          senderId: directMessages.senderId,
        });

      await ctx.db
        .update(directConversations)
        .set({ lastMessageAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(directConversations.id, input.conversationId));

      const [sender] = await ctx.db
        .select({ name: users.name, image: users.image })
        .from(users)
        .where(eq(users.id, selfId))
        .limit(1);

      const result = {
        ...message,
        senderName: sender?.name ?? null,
        senderImage: sender?.image ?? null,
      };

      // Push real-time events via Socket.IO (no-op if server not initialised).
      if (message) {
        emitNewMessage({
          messageId: message.id,
          conversationId: input.conversationId,
          senderId: selfId,
          body: message.body,
          senderName: sender?.name ?? null,
          senderImage: sender?.image ?? null,
          createdAt: message.createdAt,
        }, [convo.userOneId, convo.userTwoId]);
        emitConversationUpdated(
          [convo.userOneId, convo.userTwoId],
          { conversationId: input.conversationId, lastMessageAt: new Date() },
        );

        // Create a persistent notification for the other user (for offline/away users)
        const otherId = convo.userOneId === selfId ? convo.userTwoId : convo.userOneId;
        const senderName = sender?.name ?? "Someone";
        const preview = message.body.length > 80 ? message.body.slice(0, 80) + "…" : message.body;

        await ctx.db.insert(notifications).values({
          userId: otherId,
          type: "system",
          title: "New message",
          message: `${senderName}: ${preview}`,
          link: "/chat",
          read: false,
        });
        emitNotification(otherId, {
          id: `chat-${message.id}`,
          type: "system",
          title: "New message",
          message: `${senderName}: ${preview}`,
          link: "/chat",
        });
      }

      return result;
    }),

  listProjectConversations: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const selfId: string = ctx.session.user.id;

      return ctx.db
        .select({
          id: directConversations.id,
          userOneId: directConversations.userOneId,
          userTwoId: directConversations.userTwoId,
          lastMessageAt: directConversations.lastMessageAt,
        })
        .from(directConversations)
        .where(and(eq(directConversations.projectId, input.projectId), or(eq(directConversations.userOneId, selfId), eq(directConversations.userTwoId, selfId))))
        .orderBy(desc(directConversations.lastMessageAt));
    }),

  listAllConversations: protectedProcedure
    .query(async ({ ctx }) => {
      const selfId: string = ctx.session.user.id;

      const convos = await ctx.db
        .select({
          id: directConversations.id,
          userOneId: directConversations.userOneId,
          userTwoId: directConversations.userTwoId,
          lastMessageAt: directConversations.lastMessageAt,
        })
        .from(directConversations)
        .where(or(eq(directConversations.userOneId, selfId), eq(directConversations.userTwoId, selfId)))
        .orderBy(desc(directConversations.lastMessageAt));

      // Avoid N+1: fetch all users in one query.
      const userIds = Array.from(
        new Set(convos.flatMap((c) => [c.userOneId, c.userTwoId])),
      );

      const userRows = userIds.length
        ? await ctx.db
            .select({ id: users.id, name: users.name, email: users.email, image: users.image })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];

      const userById = new Map(userRows.map((u) => [u.id, u] as const));

      return convos
        .map((convo) => {
          const userOne = userById.get(convo.userOneId);
          const userTwo = userById.get(convo.userTwoId);
          if (!userOne || !userTwo) return null;
          return {
            id: convo.id,
            userOne,
            userTwo,
            lastMessageAt: convo.lastMessageAt,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }),

  getOrCreateDirectConversation: protectedProcedure
    .input(z.object({ otherUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const selfId: string = ctx.session.user.id;
      if (input.otherUserId === selfId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can't start a chat with yourself" });
      }

      const { userOneId, userTwoId } = normalizePair(selfId, input.otherUserId);

      const [existing] = await ctx.db
        .select({ id: directConversations.id })
        .from(directConversations)
        .where(
          and(
            eq(directConversations.userOneId, userOneId),
            eq(directConversations.userTwoId, userTwoId),
            isNull(directConversations.projectId)
          )
        )
        .limit(1);

      if (existing) return { conversationId: existing.id };

      const [created] = await ctx.db
        .insert(directConversations)
        .values({
          projectId: null,
          organizationId: null,
          userOneId,
          userTwoId,
          lastMessageAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .returning({ id: directConversations.id });

      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create conversation" });
      return { conversationId: created.id };
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const selfId: string = ctx.session.user.id;

      const [convo] = await ctx.db
        .select({
          id: directConversations.id,
          userOneId: directConversations.userOneId,
          userTwoId: directConversations.userTwoId,
        })
        .from(directConversations)
        .where(eq(directConversations.id, input.conversationId))
        .limit(1);

      if (!convo) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      if (convo.userOneId !== selfId && convo.userTwoId !== selfId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not part of this conversation" });
      }

      // Messages cascade-delete via FK constraint
      await ctx.db.delete(directConversations).where(eq(directConversations.id, input.conversationId));

      return { success: true };
    }),
});
