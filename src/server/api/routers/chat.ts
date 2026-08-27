import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, type TRPCContext } from "~/server/api/trpc";
import {
  conversationParticipants,
  directConversations,
  directMessageAttachments,
  directMessageReactions,
  directMessages,
  notifications,
  organizationMembers,
  projectCollaborators,
  projects,
  users,
} from "~/server/db/schema";
import { and, asc, count, desc, eq, gt, ilike, inArray, lt, ne, or, sql, isNull } from "drizzle-orm";
import { notify } from "~/server/notifications/dispatch";
import {
  emitNewMessage,
  emitConversationUpdated,
  emitMessageRead,
  emitMessageUpdated,
  emitMessageReaction,
} from "~/server/ws/emit";

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

/**
 * The shape every conversation-scoped procedure needs before it can act:
 * the conversation, its two members, and the caller's own participant row.
 *
 * Throws NOT_FOUND / FORBIDDEN so callers never have to repeat the check —
 * and, importantly, so nothing reaches a message body without having proven
 * membership first.
 */
async function assertParticipant(ctx: TRPCContext, conversationId: number) {
  const selfId = ctx.session?.user?.id;
  if (!selfId) throw new TRPCError({ code: "UNAUTHORIZED" });

  const [convo] = await ctx.db
    .select({
      id: directConversations.id,
      userOneId: directConversations.userOneId,
      userTwoId: directConversations.userTwoId,
      projectId: directConversations.projectId,
    })
    .from(directConversations)
    .where(eq(directConversations.id, conversationId))
    .limit(1);

  if (!convo) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
  if (convo.userOneId !== selfId && convo.userTwoId !== selfId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not part of this conversation" });
  }

  /* Conversations created before migration 0017 — and any created by a code
     path that predates this table — have no participant rows. Materialise them
     on first touch rather than making every reader cope with their absence. */
  const participant = await ensureParticipants(ctx, conversationId, [
    convo.userOneId,
    convo.userTwoId,
  ], selfId);

  const memberIds = [convo.userOneId, convo.userTwoId];
  const otherId = convo.userOneId === selfId ? convo.userTwoId : convo.userOneId;

  return { convo, selfId, otherId, memberIds, participant };
}

/**
 * Make sure every member of a conversation has a participant row, and return
 * the caller's.
 *
 * `onConflictDoNothing` makes this safe to call concurrently: two requests
 * racing to create the same row leave one insert and one no-op, not a
 * duplicate-key error surfaced to the user.
 */
async function ensureParticipants(
  ctx: TRPCContext,
  conversationId: number,
  memberIds: string[],
  selfId: string,
) {
  const existing = await ctx.db
    .select()
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));

  const missing = memberIds.filter((id) => !existing.some((p) => p.userId === id));
  if (missing.length > 0) {
    await ctx.db
      .insert(conversationParticipants)
      .values(missing.map((userId) => ({ conversationId, userId })))
      .onConflictDoNothing();
  }

  const [mine] = await ctx.db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, selfId),
      ),
    )
    .limit(1);

  if (!mine) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to load conversation membership",
    });
  }
  return mine;
}

export interface MessageReactionGroup {
  emoji: string;
  count: number;
  /** Did the caller react with this emoji? Drives the toggle's active state. */
  mine: boolean;
}

export interface MessageAttachment {
  id: number;
  url: string;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

/**
 * Batch-load everything that hangs off a page of messages.
 *
 * Three queries for the whole page rather than three per message — the thread
 * renders 50 at a time, and the per-message version was 150 round trips.
 */
async function loadMessageExtras(ctx: TRPCContext, messageIds: number[], selfId: string) {
  const empty = {
    attachments: new Map<number, MessageAttachment[]>(),
    reactions: new Map<number, MessageReactionGroup[]>(),
    replyTargets: new Map<number, { id: number; body: string; senderName: string | null; deletedAt: Date | null }>(),
  };
  if (messageIds.length === 0) return empty;

  const [attachmentRows, reactionRows, replySourceRows] = await Promise.all([
    ctx.db
      .select({
        id: directMessageAttachments.id,
        messageId: directMessageAttachments.messageId,
        url: directMessageAttachments.url,
        name: directMessageAttachments.name,
        mime: directMessageAttachments.mime,
        sizeBytes: directMessageAttachments.sizeBytes,
        width: directMessageAttachments.width,
        height: directMessageAttachments.height,
      })
      .from(directMessageAttachments)
      .where(inArray(directMessageAttachments.messageId, messageIds))
      .orderBy(asc(directMessageAttachments.id)),
    ctx.db
      .select({
        messageId: directMessageReactions.messageId,
        emoji: directMessageReactions.emoji,
        userId: directMessageReactions.userId,
      })
      .from(directMessageReactions)
      .where(inArray(directMessageReactions.messageId, messageIds)),
    ctx.db
      .select({ id: directMessages.id, replyToId: directMessages.replyToId })
      .from(directMessages)
      .where(inArray(directMessages.id, messageIds)),
  ]);

  for (const row of attachmentRows) {
    const list = empty.attachments.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      url: row.url,
      name: row.name,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
    });
    empty.attachments.set(row.messageId, list);
  }

  /* Aggregate here rather than in SQL: the page is already in memory, and a
     GROUP BY would still need a second pass to work out `mine`. */
  const byMessage = new Map<number, Map<string, { count: number; mine: boolean }>>();
  for (const row of reactionRows) {
    const forMessage =
      byMessage.get(row.messageId) ?? new Map<string, { count: number; mine: boolean }>();
    const entry = forMessage.get(row.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (row.userId === selfId) entry.mine = true;
    forMessage.set(row.emoji, entry);
    byMessage.set(row.messageId, forMessage);
  }
  for (const [messageId, forMessage] of byMessage) {
    empty.reactions.set(
      messageId,
      Array.from(forMessage.entries())
        .map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)),
    );
  }

  const replyIds = Array.from(
    new Set(replySourceRows.map((r) => r.replyToId).filter((id): id is number => id !== null)),
  );
  if (replyIds.length > 0) {
    const targets = await ctx.db
      .select({
        id: directMessages.id,
        body: directMessages.body,
        deletedAt: directMessages.deletedAt,
        senderName: users.name,
      })
      .from(directMessages)
      .innerJoin(users, eq(users.id, directMessages.senderId))
      .where(inArray(directMessages.id, replyIds));
    for (const t of targets) empty.replyTargets.set(t.id, t);
  }

  return empty;
}

/** How long one conversation's message notifications collapse into the first. */
const NOTIFICATION_COALESCE_MS = 5 * 60 * 1000;

/** A soft-deleted message shows a tombstone, never its original text. */
const TOMBSTONE = "";

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

      /* Both members get their per-person state row up front, so nothing
         downstream has to cope with a conversation that has no participants. */
      await ctx.db
        .insert(conversationParticipants)
        .values([
          { conversationId: created.id, userId: userOneId },
          { conversationId: created.id, userId: userTwoId },
        ])
        .onConflictDoNothing();

      return { conversationId: created.id };
    }),

  listMessages: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      cursor: z.number().optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const { selfId, participant, otherId } = await assertParticipant(ctx, input.conversationId);

      const conditions = [eq(directMessages.conversationId, input.conversationId)];
      if (input.cursor) {
        conditions.push(lt(directMessages.id, input.cursor));
      }
      /* History this participant cleared for themselves. The messages are still
         there for the other person — this is a per-person floor, not a delete. */
      if (participant.clearedBefore !== null) {
        conditions.push(gt(directMessages.id, participant.clearedBefore));
      }

      const rows = await ctx.db
        .select({
          id: directMessages.id,
          body: directMessages.body,
          createdAt: directMessages.createdAt,
          senderId: directMessages.senderId,
          senderName: users.name,
          senderImage: users.image,
          replyToId: directMessages.replyToId,
          editedAt: directMessages.editedAt,
          deletedAt: directMessages.deletedAt,
          pinnedAt: directMessages.pinnedAt,
        })
        .from(directMessages)
        .innerJoin(users, eq(users.id, directMessages.senderId))
        .where(and(...conditions))
        .orderBy(desc(directMessages.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      if (hasMore) rows.pop();

      const extras = await loadMessageExtras(ctx, rows.map((r) => r.id), selfId);

      /* How far the *other* participant has read, so the thread can mark the
         caller's own trailing message as seen. */
      const [peer] = await ctx.db
        .select({ lastReadMessageId: conversationParticipants.lastReadMessageId })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, otherId),
          ),
        )
        .limit(1);

      const messages = rows.map((row) => {
        const target = row.replyToId !== null ? extras.replyTargets.get(row.replyToId) : undefined;
        return {
          id: row.id,
          /* A tombstone must not ship the original text — the client renders
             "message deleted", and anything sent here is readable in devtools. */
          body: row.deletedAt ? TOMBSTONE : row.body,
          createdAt: row.createdAt,
          senderId: row.senderId,
          senderName: row.senderName,
          senderImage: row.senderImage,
          editedAt: row.editedAt,
          deletedAt: row.deletedAt,
          pinnedAt: row.pinnedAt,
          attachments: row.deletedAt ? [] : extras.attachments.get(row.id) ?? [],
          reactions: row.deletedAt ? [] : extras.reactions.get(row.id) ?? [],
          replyTo:
            target && row.replyToId !== null
              ? {
                  id: target.id,
                  body: target.deletedAt ? TOMBSTONE : target.body,
                  senderName: target.senderName,
                  deleted: target.deletedAt !== null,
                }
              : null,
        };
      });

      /* The page is selected newest-first and then reversed, so `messages` runs
         oldest -> newest and `rows[0]` is the oldest row on it. The cursor
         therefore walks *backwards* in time: it is the anchor for the page
         BEFORE this one, which is why it is named `prevCursor` and why callers
         must page with `getPreviousPageParam`/`fetchPreviousPage`.

         Naming it `nextCursor` is what led both chat clients to fetch older
         pages with `fetchNextPage`, which appends them after the newest page —
         history rendered below the latest message instead of above it. */
      messages.reverse();
      return {
        messages,
        prevCursor: hasMore ? messages[0]?.id : undefined,
        peerLastReadMessageId: peer?.lastReadMessageId ?? null,
      };
    }),

  sendMessage: protectedProcedure
    .input(
      z
        .object({
          conversationId: z.number(),
          body: z.string().max(4000),
          replyToId: z.number().optional(),
          attachments: z
            .array(
              z.object({
                url: z.string().url(),
                name: z.string().min(1).max(255),
                mime: z.string().min(1).max(127),
                sizeBytes: z.number().int().nonnegative(),
                width: z.number().int().positive().optional(),
                height: z.number().int().positive().optional(),
              }),
            )
            .max(8)
            .optional(),
        })
        /* `body` used to be `min(1)`. An attachment-only message is legitimate,
           so emptiness is now only invalid when there is nothing else to send. */
        .refine((v) => v.body.trim().length > 0 || (v.attachments?.length ?? 0) > 0, {
          message: "A message needs text or an attachment",
          path: ["body"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const { convo, selfId, otherId } = await assertParticipant(ctx, input.conversationId);

      /* A reply must point at a message in this same conversation — otherwise
         the quote block becomes a way to read a line out of someone else's
         thread by guessing ids. */
      if (input.replyToId !== undefined) {
        const [target] = await ctx.db
          .select({ id: directMessages.id })
          .from(directMessages)
          .where(
            and(
              eq(directMessages.id, input.replyToId),
              eq(directMessages.conversationId, input.conversationId),
            ),
          )
          .limit(1);
        if (!target) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Can't reply to that message" });
        }
      }

      const [message] = await ctx.db
        .insert(directMessages)
        .values({
          conversationId: input.conversationId,
          senderId: selfId,
          body: input.body,
          replyToId: input.replyToId ?? null,
        })
        .returning({
          id: directMessages.id,
          body: directMessages.body,
          createdAt: directMessages.createdAt,
          senderId: directMessages.senderId,
        });

      if (!message) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to store message" });
      }

      const storedAttachments = input.attachments?.length
        ? await ctx.db
            .insert(directMessageAttachments)
            .values(
              input.attachments.map((a) => ({
                messageId: message.id,
                url: a.url,
                name: a.name,
                mime: a.mime,
                sizeBytes: a.sizeBytes,
                width: a.width ?? null,
                height: a.height ?? null,
              })),
            )
            .returning({
              id: directMessageAttachments.id,
              url: directMessageAttachments.url,
              name: directMessageAttachments.name,
              mime: directMessageAttachments.mime,
              sizeBytes: directMessageAttachments.sizeBytes,
              width: directMessageAttachments.width,
              height: directMessageAttachments.height,
            })
        : [];

      /* Sending is also reading: without this the sender's own message counts
         against their unread badge the moment it is stored. */
      await ctx.db
        .update(conversationParticipants)
        .set({ lastReadMessageId: message.id })
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, selfId),
          ),
        );

      await ctx.db
        .update(directConversations)
        .set({ lastMessageAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(directConversations.id, input.conversationId));

      const [sender] = await ctx.db
        .select({ name: users.name, image: users.image })
        .from(users)
        .where(eq(users.id, selfId))
        .limit(1);

      const replyTo =
        input.replyToId !== undefined
          ? (
              await ctx.db
                .select({
                  id: directMessages.id,
                  body: directMessages.body,
                  deletedAt: directMessages.deletedAt,
                  senderName: users.name,
                })
                .from(directMessages)
                .innerJoin(users, eq(users.id, directMessages.senderId))
                .where(eq(directMessages.id, input.replyToId))
                .limit(1)
            )[0]
          : undefined;

      const result = {
        ...message,
        senderName: sender?.name ?? null,
        senderImage: sender?.image ?? null,
        editedAt: null as Date | null,
        deletedAt: null as Date | null,
        pinnedAt: null as Date | null,
        attachments: storedAttachments,
        reactions: [] as MessageReactionGroup[],
        replyTo: replyTo
          ? {
              id: replyTo.id,
              body: replyTo.deletedAt ? TOMBSTONE : replyTo.body,
              senderName: replyTo.senderName,
              deleted: replyTo.deletedAt !== null,
            }
          : null,
      };

      // Push real-time events via Socket.IO (no-op if server not initialised).
      emitNewMessage({
        messageId: message.id,
        conversationId: input.conversationId,
        senderId: selfId,
        body: message.body,
        senderName: sender?.name ?? null,
        senderImage: sender?.image ?? null,
        createdAt: message.createdAt,
        attachments: storedAttachments,
        replyTo: result.replyTo,
      }, [convo.userOneId, convo.userTwoId]);
      emitConversationUpdated(
        [convo.userOneId, convo.userTwoId],
        { conversationId: input.conversationId, lastMessageAt: new Date() },
      );

      /* Persistent notification for the recipient.

         This used to fire on every single message, so an active back-and-forth
         wrote a notification row per line and the bell became unusable. Two
         gates now stand in front of it: the recipient's own mute setting, and a
         coalescing window — the first message in a burst notifies, the rest ride
         along with it until the recipient reads the thread (which clears the
         notification) or the window lapses. */
      const [recipient] = await ctx.db
        .select({
          mutedUntil: conversationParticipants.mutedUntil,
        })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, otherId),
          ),
        )
        .limit(1);

      const muted = recipient?.mutedUntil !== null && recipient?.mutedUntil !== undefined
        ? recipient.mutedUntil.getTime() > Date.now()
        : false;

      if (!muted) {
        const senderName = sender?.name ?? "Someone";
        const preview =
          message.body.trim().length > 0
            ? message.body.length > 80
              ? message.body.slice(0, 80) + "…"
              : message.body
            : storedAttachments[0]?.name ?? "Attachment";

        /* Coalescing and the recipient's notification preferences are both
           applied by the dispatcher now. The conversation-level mute above stays
           here, because it is a property of this conversation rather than of the
           recipient's account. */
        await notify({
          db: ctx.db,
          userId: otherId,
          actorId: ctx.session.user.id,
          category: "directMessage",
          type: "message",
          title: "New message",
          message: `${senderName}: ${preview}`,
          link: `/chat/${input.conversationId}`,
          coalesceWindowMs: NOTIFICATION_COALESCE_MS,
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
          projectId: directConversations.projectId,
          projectTitle: projects.title,
        })
        .from(directConversations)
        .leftJoin(projects, eq(projects.id, directConversations.projectId))
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

      const convoIds = convos.map((c) => c.id);
      if (convoIds.length === 0) return [];

      /* Everything below is per-conversation state that used to have nowhere to
         live, so the rail could only ever show a name and an email. Three batch
         queries rather than three per row. */
      const [participantRows, newestIdRows, unreadRows] = await Promise.all([
        ctx.db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              inArray(conversationParticipants.conversationId, convoIds),
              eq(conversationParticipants.userId, selfId),
            ),
          ),
        ctx.db
          .select({
            conversationId: directMessages.conversationId,
            newestId: sql<number>`MAX(${directMessages.id})`.as("newest_id"),
          })
          .from(directMessages)
          .where(inArray(directMessages.conversationId, convoIds))
          .groupBy(directMessages.conversationId),
        /* Unread = stored after my read pointer and not written by me. Messages
           I sent can never be unread for me, which is why the sender is excluded
           rather than relying on the pointer alone. */
        ctx.db
          .select({
            conversationId: directMessages.conversationId,
            unread: count(),
          })
          .from(directMessages)
          .innerJoin(
            conversationParticipants,
            and(
              eq(conversationParticipants.conversationId, directMessages.conversationId),
              eq(conversationParticipants.userId, selfId),
            ),
          )
          .where(
            and(
              inArray(directMessages.conversationId, convoIds),
              ne(directMessages.senderId, selfId),
              isNull(directMessages.deletedAt),
              sql`${directMessages.id} > COALESCE(${conversationParticipants.lastReadMessageId}, 0)`,
              sql`${directMessages.id} > COALESCE(${conversationParticipants.clearedBefore}, 0)`,
            ),
          )
          .groupBy(directMessages.conversationId),
      ]);

      const newestIds = newestIdRows.map((r) => r.newestId).filter((id): id is number => id != null);

      /* The preview's attachment name is fetched as its own batch rather than a
         correlated subquery: drizzle maps a raw `sql` field in a select list by
         the column name postgres reports, and an expression has none, so the
         value silently arrived as null however it was aliased. */
      const [lastMessageRows, previewAttachments] = newestIds.length
        ? await Promise.all([
            ctx.db
              .select({
                id: directMessages.id,
                conversationId: directMessages.conversationId,
                body: directMessages.body,
                senderId: directMessages.senderId,
                createdAt: directMessages.createdAt,
                deletedAt: directMessages.deletedAt,
              })
              .from(directMessages)
              .where(inArray(directMessages.id, newestIds)),
            ctx.db
              .select({
                messageId: directMessageAttachments.messageId,
                name: directMessageAttachments.name,
              })
              .from(directMessageAttachments)
              .where(inArray(directMessageAttachments.messageId, newestIds))
              .orderBy(asc(directMessageAttachments.id)),
          ])
        : [[], []];

      /* First attachment wins — the rail shows one name, not a list. */
      const attachmentNameByMessage = new Map<number, string>();
      for (const row of previewAttachments) {
        if (!attachmentNameByMessage.has(row.messageId)) {
          attachmentNameByMessage.set(row.messageId, row.name);
        }
      }

      const participantByConvo = new Map(participantRows.map((p) => [p.conversationId, p] as const));
      const lastByConvo = new Map(lastMessageRows.map((r) => [r.conversationId, r] as const));
      const unreadByConvo = new Map(unreadRows.map((r) => [r.conversationId, r.unread] as const));

      const now = Date.now();

      return convos
        .map((convo) => {
          const userOne = userById.get(convo.userOneId);
          const userTwo = userById.get(convo.userTwoId);
          if (!userOne || !userTwo) return null;

          const participant = participantByConvo.get(convo.id);
          /* A participant row can legitimately be missing here for a
             conversation nothing has touched since the migration; treat it as
             the default state rather than dropping the row from the rail. */
          const cleared = participant?.clearedBefore ?? null;
          const last = lastByConvo.get(convo.id);
          const lastVisible = last && (cleared === null || last.id > cleared) ? last : null;

          return {
            id: convo.id,
            userOne,
            userTwo,
            lastMessageAt: convo.lastMessageAt,
            projectId: convo.projectId,
            projectTitle: convo.projectTitle,
            unreadCount: unreadByConvo.get(convo.id) ?? 0,
            muted:
              participant?.mutedUntil != null &&
              participant.mutedUntil.getTime() > now,
            archived: participant?.archivedAt != null,
            lastMessage: lastVisible
              ? {
                  id: lastVisible.id,
                  body: lastVisible.deletedAt ? TOMBSTONE : lastVisible.body,
                  senderId: lastVisible.senderId,
                  createdAt: lastVisible.createdAt,
                  deleted: lastVisible.deletedAt !== null,
                  attachmentName: lastVisible.deletedAt
                    ? null
                    : attachmentNameByMessage.get(lastVisible.id) ?? null,
                }
              : null,
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

      /* Both members get their per-person state row up front, so nothing
         downstream has to cope with a conversation that has no participants. */
      await ctx.db
        .insert(conversationParticipants)
        .values([
          { conversationId: created.id, userId: userOneId },
          { conversationId: created.id, userId: userTwoId },
        ])
        .onConflictDoNothing();

      return { conversationId: created.id };
    }),

  /**
   * Advance this participant's read pointer.
   *
   * Monotonic on purpose: scrolling up through history, or a `message:read`
   * frame arriving out of order, must never make an already-read thread unread
   * again. `GREATEST` does that in one statement, so two concurrent calls can't
   * interleave into a rewind either.
   */
  markRead: protectedProcedure
    .input(z.object({ conversationId: z.number(), messageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { selfId, otherId } = await assertParticipant(ctx, input.conversationId);

      const [updated] = await ctx.db
        .update(conversationParticipants)
        .set({
          lastReadMessageId: sql`GREATEST(COALESCE(${conversationParticipants.lastReadMessageId}, 0), ${input.messageId})`,
        })
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, selfId),
          ),
        )
        .returning({ lastReadMessageId: conversationParticipants.lastReadMessageId });

      /* Clear the coalesced chat notification for this thread — having read it,
         the badge should go with it. */
      await ctx.db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.userId, selfId),
            eq(notifications.link, `/chat/${input.conversationId}`),
            eq(notifications.read, false),
          ),
        );

      /* Tell the other participant their message was seen. Only they need it —
         the caller already knows what they just read. */
      emitMessageRead(otherId, {
        conversationId: input.conversationId,
        userId: selfId,
        messageId: updated?.lastReadMessageId ?? input.messageId,
      });

      return { lastReadMessageId: updated?.lastReadMessageId ?? input.messageId };
    }),

  /** One number for the nav badge: unread messages across every conversation. */
  getUnreadTotal: protectedProcedure.query(async ({ ctx }) => {
    const selfId: string = ctx.session.user.id;

    const [row] = await ctx.db
      .select({ total: count() })
      .from(directMessages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, directMessages.conversationId),
          eq(conversationParticipants.userId, selfId),
        ),
      )
      .where(
        and(
          ne(directMessages.senderId, selfId),
          isNull(directMessages.deletedAt),
          isNull(conversationParticipants.leftAt),
          /* A muted thread still counts as unread in its own row, but it must
             not drive the global badge — that is the whole point of muting. */
          or(
            isNull(conversationParticipants.mutedUntil),
            lt(conversationParticipants.mutedUntil, new Date()),
          ),
          sql`${directMessages.id} > COALESCE(${conversationParticipants.lastReadMessageId}, 0)`,
          sql`${directMessages.id} > COALESCE(${conversationParticipants.clearedBefore}, 0)`,
        ),
      );

    return { total: row?.total ?? 0 };
  }),

  /** Mute and archive, which are both per-participant and both partial updates. */
  setConversationPrefs: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
        muted: z.boolean().optional(),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { selfId } = await assertParticipant(ctx, input.conversationId);

      const patch: { mutedUntil?: Date | null; archivedAt?: Date | null } = {};
      if (input.muted !== undefined) {
        /* Stored as a timestamp rather than a boolean so "mute for 8 hours" is
           a value change later, not a schema change. Indefinite mute is simply
           a date far enough out that it never lapses on its own. */
        patch.mutedUntil = input.muted
          ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10)
          : null;
      }
      if (input.archived !== undefined) {
        patch.archivedAt = input.archived ? new Date() : null;
      }
      if (Object.keys(patch).length === 0) return { ok: true };

      await ctx.db
        .update(conversationParticipants)
        .set(patch)
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, selfId),
          ),
        );

      return { ok: true };
    }),

  /**
   * Add or remove one reaction.
   *
   * Returns the full aggregate for the message rather than a delta, and the
   * socket frame carries the same thing — a duplicated or dropped frame then
   * cannot leave two clients disagreeing about the count.
   */
  toggleReaction: protectedProcedure
    .input(z.object({ messageId: z.number(), emoji: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const [message] = await ctx.db
        .select({
          id: directMessages.id,
          conversationId: directMessages.conversationId,
          deletedAt: directMessages.deletedAt,
        })
        .from(directMessages)
        .where(eq(directMessages.id, input.messageId))
        .limit(1);

      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (message.deletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can't react to a deleted message" });
      }

      const { selfId, memberIds } = await assertParticipant(ctx, message.conversationId);

      const deleted = await ctx.db
        .delete(directMessageReactions)
        .where(
          and(
            eq(directMessageReactions.messageId, input.messageId),
            eq(directMessageReactions.userId, selfId),
            eq(directMessageReactions.emoji, input.emoji),
          ),
        )
        .returning({ id: directMessageReactions.id });

      if (deleted.length === 0) {
        await ctx.db
          .insert(directMessageReactions)
          .values({ messageId: input.messageId, userId: selfId, emoji: input.emoji })
          .onConflictDoNothing();
      }

      const rows = await ctx.db
        .select({ emoji: directMessageReactions.emoji, userId: directMessageReactions.userId })
        .from(directMessageReactions)
        .where(eq(directMessageReactions.messageId, input.messageId));

      const grouped = new Map<string, { count: number; mine: boolean }>();
      for (const r of rows) {
        const entry = grouped.get(r.emoji) ?? { count: 0, mine: false };
        entry.count += 1;
        if (r.userId === selfId) entry.mine = true;
        grouped.set(r.emoji, entry);
      }
      const aggregate = Array.from(grouped.entries())
        .map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));

      /* `mine` is per viewer, so the frame carries the reactor ids and each
         client works out its own. Sending the caller's `mine` to everyone would
         light up the other person's chip as if they had reacted. */
      emitMessageReaction(message.conversationId, memberIds, {
        conversationId: message.conversationId,
        messageId: input.messageId,
        reactions: Array.from(grouped.entries()).map(([emoji]) => ({
          emoji,
          userIds: rows.filter((r) => r.emoji === emoji).map((r) => r.userId),
        })),
      });

      return { messageId: input.messageId, reactions: aggregate };
    }),

  editMessage: protectedProcedure
    .input(z.object({ messageId: z.number(), body: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const selfId: string = ctx.session.user.id;

      const [message] = await ctx.db
        .select({
          id: directMessages.id,
          conversationId: directMessages.conversationId,
          senderId: directMessages.senderId,
          deletedAt: directMessages.deletedAt,
        })
        .from(directMessages)
        .where(eq(directMessages.id, input.messageId))
        .limit(1);

      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (message.senderId !== selfId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own messages" });
      }
      if (message.deletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That message was deleted" });
      }

      const { memberIds } = await assertParticipant(ctx, message.conversationId);

      const [updated] = await ctx.db
        .update(directMessages)
        .set({ body: input.body, editedAt: new Date() })
        .where(eq(directMessages.id, input.messageId))
        .returning({
          id: directMessages.id,
          body: directMessages.body,
          editedAt: directMessages.editedAt,
        });

      emitMessageUpdated(message.conversationId, memberIds, {
        conversationId: message.conversationId,
        messageId: input.messageId,
        body: updated?.body ?? input.body,
        editedAt: updated?.editedAt ?? new Date(),
        deletedAt: null,
        pinnedAt: undefined,
      });

      return { id: input.messageId, body: updated?.body ?? input.body, editedAt: updated?.editedAt ?? new Date() };
    }),

  /**
   * Soft-delete. The row stays so replies keep their quote target and read
   * pointers keep their meaning; the body is cleared in place so the text is
   * genuinely gone rather than merely hidden by the client.
   */
  deleteMessage: protectedProcedure
    .input(z.object({ messageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const selfId: string = ctx.session.user.id;

      const [message] = await ctx.db
        .select({
          id: directMessages.id,
          conversationId: directMessages.conversationId,
          senderId: directMessages.senderId,
        })
        .from(directMessages)
        .where(eq(directMessages.id, input.messageId))
        .limit(1);

      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (message.senderId !== selfId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own messages" });
      }

      const { memberIds } = await assertParticipant(ctx, message.conversationId);
      const deletedAt = new Date();

      await ctx.db
        .update(directMessages)
        .set({ body: TOMBSTONE, deletedAt, pinnedAt: null, pinnedBy: null })
        .where(eq(directMessages.id, input.messageId));

      /* Attachments and reactions are cascade-deleted rather than left orphaned:
         a deleted message must not keep serving its files. */
      await Promise.all([
        ctx.db.delete(directMessageAttachments).where(eq(directMessageAttachments.messageId, input.messageId)),
        ctx.db.delete(directMessageReactions).where(eq(directMessageReactions.messageId, input.messageId)),
      ]);

      emitMessageUpdated(message.conversationId, memberIds, {
        conversationId: message.conversationId,
        messageId: input.messageId,
        body: TOMBSTONE,
        editedAt: null,
        deletedAt,
        pinnedAt: null,
      });

      return { id: input.messageId, deletedAt };
    }),

  togglePin: protectedProcedure
    .input(z.object({ messageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [message] = await ctx.db
        .select({
          id: directMessages.id,
          conversationId: directMessages.conversationId,
          pinnedAt: directMessages.pinnedAt,
          deletedAt: directMessages.deletedAt,
        })
        .from(directMessages)
        .where(eq(directMessages.id, input.messageId))
        .limit(1);

      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (message.deletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can't pin a deleted message" });
      }

      const { selfId, memberIds } = await assertParticipant(ctx, message.conversationId);
      const nextPinnedAt = message.pinnedAt ? null : new Date();

      await ctx.db
        .update(directMessages)
        .set({ pinnedAt: nextPinnedAt, pinnedBy: nextPinnedAt ? selfId : null })
        .where(eq(directMessages.id, input.messageId));

      emitMessageUpdated(message.conversationId, memberIds, {
        conversationId: message.conversationId,
        messageId: input.messageId,
        body: undefined,
        editedAt: undefined,
        deletedAt: undefined,
        pinnedAt: nextPinnedAt,
      });

      return { id: input.messageId, pinnedAt: nextPinnedAt };
    }),

  /**
   * Search message bodies, scoped to one conversation or across all of them.
   *
   * Substring matching via ILIKE rather than a full-text index: `to_tsvector`
   * matches whole lexemes, so typing "cater" would not find "caterer" — wrong
   * behaviour for a search-as-you-type box. Every candidate set is already
   * narrowed by conversation membership, which is indexed.
   */
  searchMessages: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(100),
        conversationId: z.number().optional(),
        limit: z.number().min(1).max(50).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const selfId: string = ctx.session.user.id;

      let conversationIds: number[];
      if (input.conversationId !== undefined) {
        await assertParticipant(ctx, input.conversationId);
        conversationIds = [input.conversationId];
      } else {
        const mine = await ctx.db
          .select({ id: directConversations.id })
          .from(directConversations)
          .where(
            or(
              eq(directConversations.userOneId, selfId),
              eq(directConversations.userTwoId, selfId),
            ),
          );
        conversationIds = mine.map((c) => c.id);
      }
      if (conversationIds.length === 0) return [];

      /* `%` and `_` are ILIKE wildcards; without escaping, a query of "%" would
         match every message the caller can see. */
      const escaped = input.query.replace(/[\\%_]/g, (ch) => `\\${ch}`);

      const rows = await ctx.db
        .select({
          id: directMessages.id,
          conversationId: directMessages.conversationId,
          body: directMessages.body,
          createdAt: directMessages.createdAt,
          senderId: directMessages.senderId,
          senderName: users.name,
        })
        .from(directMessages)
        .innerJoin(users, eq(users.id, directMessages.senderId))
        .innerJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, directMessages.conversationId),
            eq(conversationParticipants.userId, selfId),
          ),
        )
        .where(
          and(
            inArray(directMessages.conversationId, conversationIds),
            isNull(directMessages.deletedAt),
            ilike(directMessages.body, `%${escaped}%`),
            sql`${directMessages.id} > COALESCE(${conversationParticipants.clearedBefore}, 0)`,
          ),
        )
        .orderBy(desc(directMessages.id))
        .limit(input.limit);

      return rows;
    }),

  /** Pinned messages, shared files and shared projects for the details pane. */
  getConversationDetails: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { participant, otherId } = await assertParticipant(ctx, input.conversationId);
      const floor = participant.clearedBefore ?? 0;

      const [pinned, files, sharedProjects] = await Promise.all([
        ctx.db
          .select({
            id: directMessages.id,
            body: directMessages.body,
            pinnedAt: directMessages.pinnedAt,
            senderName: users.name,
            createdAt: directMessages.createdAt,
          })
          .from(directMessages)
          .innerJoin(users, eq(users.id, directMessages.senderId))
          .where(
            and(
              eq(directMessages.conversationId, input.conversationId),
              isNull(directMessages.deletedAt),
              sql`${directMessages.pinnedAt} IS NOT NULL`,
              gt(directMessages.id, floor),
            ),
          )
          .orderBy(desc(directMessages.pinnedAt)),
        ctx.db
          .select({
            id: directMessageAttachments.id,
            messageId: directMessageAttachments.messageId,
            url: directMessageAttachments.url,
            name: directMessageAttachments.name,
            mime: directMessageAttachments.mime,
            sizeBytes: directMessageAttachments.sizeBytes,
            createdAt: directMessageAttachments.createdAt,
          })
          .from(directMessageAttachments)
          .innerJoin(directMessages, eq(directMessages.id, directMessageAttachments.messageId))
          .where(
            and(
              eq(directMessages.conversationId, input.conversationId),
              isNull(directMessages.deletedAt),
              gt(directMessages.id, floor),
            ),
          )
          .orderBy(desc(directMessageAttachments.id))
          .limit(50),
        /* Projects both people can reach — the "shared work" list. */
        ctx.db
          .select({ id: projects.id, title: projects.title })
          .from(projects)
          .innerJoin(projectCollaborators, eq(projectCollaborators.projectId, projects.id))
          .where(inArray(projectCollaborators.collaboratorId, [participant.userId, otherId]))
          .groupBy(projects.id, projects.title)
          .having(sql`COUNT(DISTINCT ${projectCollaborators.collaboratorId}) = 2`)
          .limit(10),
      ]);

      return { pinned, files, sharedProjects };
    }),

  /**
   * Hide history for the caller only.
   *
   * The old `deleteConversation` dropped the conversation row and cascade-deleted
   * every message in it, which destroyed the other participant's copy of the
   * thread without their consent. This moves a per-person floor instead: the
   * caller's thread reads empty, the other person's is untouched.
   */
  clearHistory: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { selfId } = await assertParticipant(ctx, input.conversationId);

      const [newest] = await ctx.db
        .select({ id: directMessages.id })
        .from(directMessages)
        .where(eq(directMessages.conversationId, input.conversationId))
        .orderBy(desc(directMessages.id))
        .limit(1);

      const floor = newest?.id ?? 0;

      await ctx.db
        .update(conversationParticipants)
        .set({ clearedBefore: floor, lastReadMessageId: floor })
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, selfId),
          ),
        );

      return { clearedBefore: floor };
    }),

  /**
   * Leave for good. The conversation row and its messages are only really
   * destroyed once nobody is left to read them.
   */
  leaveConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { selfId, memberIds } = await assertParticipant(ctx, input.conversationId);
      const now = new Date();

      await ctx.db
        .update(conversationParticipants)
        .set({ leftAt: now, archivedAt: now })
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, selfId),
          ),
        );

      const remaining = await ctx.db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            isNull(conversationParticipants.leftAt),
          ),
        );

      let purged = false;
      if (remaining.length === 0) {
        await ctx.db
          .delete(directConversations)
          .where(eq(directConversations.id, input.conversationId));
        purged = true;
      }

      emitConversationUpdated(memberIds, {
        conversationId: input.conversationId,
        lastMessageAt: now,
      });

      return { left: true, purged };
    }),
});
