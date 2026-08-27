/**
 * Other people's profiles.
 *
 * `user.getProfile` returns *your own* record and always has; nothing in the
 * codebase could answer "who is this person I just tapped". This router is that
 * answer, and every procedure in it starts by asking
 * `~/server/profile/visibility` what the caller is allowed to see rather than
 * deciding for itself.
 *
 * Shared context and activity are derived from tables that already exist —
 * projects, RSVPs, events — so nothing had to start writing an activity log for
 * the feed to have something in it. The only new table is the follow graph,
 * which genuinely has nowhere else to live.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  eventRsvps,
  events,
  organizationMembers,
  organizations,
  projectCollaborators,
  projects,
  userFollows,
  users,
} from "~/server/db/schema";
import { notify } from "~/server/notifications/dispatch";
import { isOnline, resolveProfileAccess } from "~/server/profile/visibility";

/** The columns a profile card ever needs. Narrow on purpose: no password, no 2FA secret. */
const PROFILE_COLUMNS = {
  id: true,
  name: true,
  email: true,
  image: true,
  bio: true,
  createdAt: true,
  timezone: true,
  showOnlineStatus: true,
  lastSeenAt: true,
  allowFollowers: true,
  showActivityFeed: true,
} as const;

export const profileRouter = createTRPCRouter({
  /**
   * The drawer's header and counts.
   *
   * Returns a discriminated shape rather than throwing on a restricted profile:
   * the client has a card to render either way, and a thrown FORBIDDEN would
   * turn a tap on an avatar into an error toast.
   */
  getPublicProfile: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.session.user.id;
      const access = await resolveProfileAccess(ctx.db, viewerId, input.userId);

      if (access.level === "hidden") return null;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: PROFILE_COLUMNS,
      });

      if (!user) return null;

      const base = {
        id: user.id,
        name: user.name,
        image: user.image,
        isSelf: access.isSelf,
      };

      if (access.level === "minimal") {
        return { ...base, restricted: true as const };
      }

      // Role in the organisation the two of them share. When they share more
      // than one, the first is enough for a card; the drawer is not an org
      // browser. Viewing yourself falls back to every org you belong to.
      const orgIds = access.isSelf
        ? (
            await ctx.db
              .select({ id: organizationMembers.organizationId })
              .from(organizationMembers)
              .where(eq(organizationMembers.userId, input.userId))
          ).map((r) => r.id)
        : access.sharedOrganizationIds;

      const membership =
        orgIds.length > 0
          ? (
              await ctx.db
                .select({
                  role: organizationMembers.role,
                  joinedAt: organizationMembers.joinedAt,
                  organizationId: organizations.id,
                  organizationName: organizations.name,
                })
                .from(organizationMembers)
                .innerJoin(
                  organizations,
                  eq(organizationMembers.organizationId, organizations.id),
                )
                .where(
                  and(
                    eq(organizationMembers.userId, input.userId),
                    inArray(organizationMembers.organizationId, orgIds),
                  ),
                )
                .limit(1)
            )[0] ?? null
          : null;

      const [followerCount, followingCount, outgoing, incoming] =
        await Promise.all([
          ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(userFollows)
            .where(eq(userFollows.followingId, input.userId)),
          ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(userFollows)
            .where(eq(userFollows.followerId, input.userId)),
          access.isSelf
            ? Promise.resolve([])
            : ctx.db
                .select({ createdAt: userFollows.createdAt })
                .from(userFollows)
                .where(
                  and(
                    eq(userFollows.followerId, viewerId),
                    eq(userFollows.followingId, input.userId),
                  ),
                )
                .limit(1),
          access.isSelf
            ? Promise.resolve([])
            : ctx.db
                .select({ createdAt: userFollows.createdAt })
                .from(userFollows)
                .where(
                  and(
                    eq(userFollows.followerId, input.userId),
                    eq(userFollows.followingId, viewerId),
                  ),
                )
                .limit(1),
        ]);

      return {
        ...base,
        restricted: false as const,
        email: user.email,
        bio: user.bio,
        createdAt: user.createdAt,
        timezone: user.timezone,
        // Honour the target's own switch. A viewer never learns that the switch
        // is off — an absent status and a hidden status look identical.
        online: user.showOnlineStatus ? isOnline(user.lastSeenAt) : null,
        organization: membership
          ? { id: membership.organizationId, name: membership.organizationName }
          : null,
        role: membership?.role ?? null,
        joinedOrgAt: membership?.joinedAt ?? null,
        followerCount: followerCount[0]?.n ?? 0,
        followingCount: followingCount[0]?.n ?? 0,
        isFollowing: outgoing.length > 0,
        followsYou: incoming.length > 0,
        canFollow: !access.isSelf && user.allowFollowers,
        showsActivity: user.showActivityFeed || access.isSelf,
      };
    }),

  /**
   * Projects, events and organisations the two of you have in common.
   *
   * Deliberately the *intersection* and not the target's whole workload: the
   * question the drawer answers is "how do I know this person", and listing
   * projects the viewer has no access to would leak titles.
   */
  getSharedContext: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.session.user.id;
      const access = await resolveProfileAccess(ctx.db, viewerId, input.userId);

      if (access.level !== "full" || access.isSelf) {
        return { projects: [], events: [], organizations: [] };
      }

      // Membership of a project = collaborator row or ownership.
      const membershipRows = await ctx.db
        .select({
          projectId: projectCollaborators.projectId,
          userId: projectCollaborators.collaboratorId,
        })
        .from(projectCollaborators)
        .where(
          inArray(projectCollaborators.collaboratorId, [viewerId, input.userId]),
        );

      const ownerRows = await ctx.db
        .select({ projectId: projects.id, userId: projects.createdById })
        .from(projects)
        .where(inArray(projects.createdById, [viewerId, input.userId]));

      const all = [...membershipRows, ...ownerRows];
      const mine = new Set(
        all.filter((r) => r.userId === viewerId).map((r) => r.projectId),
      );
      const sharedProjectIds = [
        ...new Set(
          all
            .filter((r) => r.userId === input.userId && mine.has(r.projectId))
            .map((r) => r.projectId),
        ),
      ];

      const sharedProjects =
        sharedProjectIds.length > 0
          ? await ctx.db
              .select({
                id: projects.id,
                title: projects.title,
                status: projects.status,
                imageUrl: projects.imageUrl,
              })
              .from(projects)
              .where(inArray(projects.id, sharedProjectIds))
              .orderBy(desc(projects.updatedAt))
              .limit(8)
          : [];

      // Upcoming events only. A shared event from two years ago is history, not
      // context, and the drawer has room for neither.
      const now = new Date();
      const rsvpRows = await ctx.db
        .select({ eventId: eventRsvps.eventId, userId: eventRsvps.userId })
        .from(eventRsvps)
        .where(
          and(
            inArray(eventRsvps.userId, [viewerId, input.userId]),
            ne(eventRsvps.status, "not_going"),
          ),
        );

      const myEvents = new Set(
        rsvpRows.filter((r) => r.userId === viewerId).map((r) => r.eventId),
      );
      const sharedEventIds = [
        ...new Set(
          rsvpRows
            .filter((r) => r.userId === input.userId && myEvents.has(r.eventId))
            .map((r) => r.eventId),
        ),
      ];

      const sharedEvents =
        sharedEventIds.length > 0
          ? await ctx.db
              .select({
                id: events.id,
                title: events.title,
                eventDate: events.eventDate,
                region: events.region,
              })
              .from(events)
              .where(
                and(
                  inArray(events.id, sharedEventIds),
                  gte(events.eventDate, now),
                ),
              )
              .orderBy(events.eventDate)
              .limit(8)
          : [];

      const sharedOrgs =
        access.sharedOrganizationIds.length > 0
          ? await ctx.db
              .select({ id: organizations.id, name: organizations.name })
              .from(organizations)
              .where(inArray(organizations.id, access.sharedOrganizationIds))
          : [];

      return {
        projects: sharedProjects,
        events: sharedEvents,
        organizations: sharedOrgs,
      };
    }),

  /**
   * Who to follow.
   *
   * Ranked by the two overlaps this schema can actually prove: people who host
   * or attend the events you attend, and people in your organisations. No
   * "people you may know" heuristics beyond that — a suggestion the system
   * cannot justify is a stranger with a Follow button on them.
   *
   * Everyone already followed, and everyone who has turned followers off, is
   * excluded before ranking rather than filtered out of the results, so asking
   * for six suggestions does not quietly return two.
   */
  getSuggestions: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.session.user.id;
      const limit = input?.limit ?? 5;

      /**
       * Assembled from plain queries rather than one correlated monster.
       *
       * The first draft wrote the subqueries by hand with aliases, which meant
       * spelling column names in raw SQL — and this database does not use one
       * naming convention throughout (`event."createdById"` beside
       * `event_rsvp.user_id`). Every query below goes through drizzle, so the
       * names come from the schema and cannot drift from it.
       */
      const [myRsvps, myOrgs, alreadyFollowing] = await Promise.all([
        ctx.db
          .select({ eventId: eventRsvps.eventId })
          .from(eventRsvps)
          .where(
            and(eq(eventRsvps.userId, viewerId), ne(eventRsvps.status, "not_going")),
          )
          .orderBy(desc(eventRsvps.createdAt))
          .limit(200),
        ctx.db
          .select({ organizationId: organizationMembers.organizationId })
          .from(organizationMembers)
          .where(eq(organizationMembers.userId, viewerId)),
        ctx.db
          .select({ id: userFollows.followingId })
          .from(userFollows)
          .where(eq(userFollows.followerId, viewerId)),
      ]);

      const myEventIds = myRsvps.map((row) => row.eventId);
      const myOrgIds = myOrgs.map((row) => row.organizationId);
      const excluded = new Set([viewerId, ...alreadyFollowing.map((row) => row.id)]);

      /** userId -> why they are worth suggesting. */
      const scores = new Map<
        string,
        { sharedEvents: number; hostedForYou: number; sharedOrgs: number }
      >();
      const bump = (
        userId: string,
        key: "sharedEvents" | "hostedForYou" | "sharedOrgs",
      ) => {
        if (excluded.has(userId)) return;
        const entry = scores.get(userId) ?? {
          sharedEvents: 0,
          hostedForYou: 0,
          sharedOrgs: 0,
        };
        entry[key] += 1;
        scores.set(userId, entry);
      };

      if (myEventIds.length > 0) {
        const [alsoGoing, hosts] = await Promise.all([
          ctx.db
            .select({ userId: eventRsvps.userId })
            .from(eventRsvps)
            .where(
              and(
                inArray(eventRsvps.eventId, myEventIds),
                ne(eventRsvps.status, "not_going"),
              ),
            )
            .limit(2000),
          ctx.db
            .select({ createdById: events.createdById })
            .from(events)
            .where(inArray(events.id, myEventIds)),
        ]);

        for (const row of alsoGoing) bump(row.userId, "sharedEvents");
        for (const row of hosts) bump(row.createdById, "hostedForYou");
      }

      if (myOrgIds.length > 0) {
        const colleagues = await ctx.db
          .select({ userId: organizationMembers.userId })
          .from(organizationMembers)
          .where(inArray(organizationMembers.organizationId, myOrgIds))
          .limit(2000);

        for (const row of colleagues) bump(row.userId, "sharedOrgs");
      }

      const ranked = [...scores.entries()]
        .map(([id, parts]) => ({
          id,
          ...parts,
          score: parts.hostedForYou * 4 + parts.sharedEvents * 3 + parts.sharedOrgs * 2,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit * 3);

      if (ranked.length === 0) return [];

      /* Only now fetch the people, and only those still accepting followers. */
      const candidates = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          image: users.image,
          upcomingHosted: sql<number>`(SELECT count(*) FROM ${events} WHERE ${events.createdById} = ${users.id} AND ${events.eventDate} >= now())`.mapWith(
            Number,
          ),
        })
        .from(users)
        .where(
          and(
            inArray(users.id, ranked.map((row) => row.id)),
            eq(users.allowFollowers, true),
          ),
        );

      const byId = new Map(candidates.map((person) => [person.id, person]));

      return ranked
        .filter((row) => byId.has(row.id))
        .slice(0, limit)
        .map((row) => {
          const person = byId.get(row.id)!;
          return {
            id: person.id,
            name: person.name,
            image: person.image,
            upcomingHosted: person.upcomingHosted,
            /* Why they are being suggested, so the panel can say it out loud. */
            reason:
              row.hostedForYou > 0
                ? ({ kind: "hostedForYou", count: row.hostedForYou } as const)
                : row.sharedEvents > 0
                  ? ({ kind: "sharedEvents", count: row.sharedEvents } as const)
                  : ({ kind: "sharedOrgs", count: row.sharedOrgs } as const),
          };
        });
    }),

  /**
   * A derived activity feed.
   *
   * Two sources — events this person published, and events they said they are
   * going to — merged and sorted by the timestamp each row carries. Nothing
   * writes an activity row anywhere, which is the point: the feed can never
   * disagree with the underlying data because it *is* the underlying data.
   */
  getActivity: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        limit: z.number().min(1).max(50).default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.session.user.id;
      const access = await resolveProfileAccess(ctx.db, viewerId, input.userId);

      if (access.level !== "full") return [];

      const target = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { showActivityFeed: true },
      });

      if (!target || (!target.showActivityFeed && !access.isSelf)) return [];

      const [published, attending] = await Promise.all([
        ctx.db
          .select({
            id: events.id,
            title: events.title,
            at: events.createdAt,
            eventDate: events.eventDate,
          })
          .from(events)
          .where(eq(events.createdById, input.userId))
          .orderBy(desc(events.createdAt))
          .limit(input.limit),
        ctx.db
          .select({
            id: events.id,
            title: events.title,
            at: eventRsvps.updatedAt,
            eventDate: events.eventDate,
          })
          .from(eventRsvps)
          .innerJoin(events, eq(eventRsvps.eventId, events.id))
          .where(
            and(
              eq(eventRsvps.userId, input.userId),
              ne(eventRsvps.status, "not_going"),
            ),
          )
          .orderBy(desc(eventRsvps.updatedAt))
          .limit(input.limit),
      ]);

      const merged = [
        ...published.map((e) => ({
          kind: "published_event" as const,
          eventId: e.id,
          title: e.title,
          at: e.at,
          eventDate: e.eventDate,
        })),
        ...attending
          // An RSVP to your own event is the same fact as publishing it.
          .filter((e) => !published.some((p) => p.id === e.id))
          .map((e) => ({
            kind: "rsvp" as const,
            eventId: e.id,
            title: e.title,
            at: e.at,
            eventDate: e.eventDate,
          })),
      ];

      merged.sort((a, b) => b.at.getTime() - a.at.getTime());
      return merged.slice(0, input.limit);
    }),

  follow: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const viewerId = ctx.session.user.id;

      if (viewerId === input.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot follow yourself.",
        });
      }

      const access = await resolveProfileAccess(ctx.db, viewerId, input.userId);
      if (access.level !== "full") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This profile is not open to you.",
        });
      }

      const target = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { id: true, allowFollowers: true },
      });

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such user." });
      }
      if (!target.allowFollowers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This person is not accepting followers.",
        });
      }

      // `onConflictDoNothing` rather than a check-then-insert: two taps in
      // flight at once would otherwise race, and the composite key would turn
      // the loser into a 500 instead of a no-op.
      const inserted = await ctx.db
        .insert(userFollows)
        .values({ followerId: viewerId, followingId: input.userId })
        .onConflictDoNothing()
        .returning({ followerId: userFollows.followerId });

      // Only notify on a genuinely new follow, so re-tapping cannot be used to
      // spam somebody's bell.
      if (inserted.length > 0) {
        const actor = await ctx.db.query.users.findFirst({
          where: eq(users.id, viewerId),
          columns: { name: true, email: true },
        });

        await notify({
          db: ctx.db,
          userId: input.userId,
          actorId: viewerId,
          category: "social",
          type: "system",
          title: "New follower",
          message: `${actor?.name ?? actor?.email ?? "Someone"} started following you.`,
          link: `/profile/${viewerId}`,
        });
      }

      return { following: true };
    }),

  unfollow: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(userFollows)
        .where(
          and(
            eq(userFollows.followerId, ctx.session.user.id),
            eq(userFollows.followingId, input.userId),
          ),
        );

      return { following: false };
    }),

  /**
   * Followers or following, as people cards.
   *
   * Gated by the same access check as the profile itself — a restricted profile
   * does not get to have its follow graph enumerated through a side door.
   */
  listFollows: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        direction: z.enum(["followers", "following"]),
        limit: z.number().min(1).max(100).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await resolveProfileAccess(
        ctx.db,
        ctx.session.user.id,
        input.userId,
      );
      if (access.level !== "full") return [];

      const [matchColumn, pickColumn] =
        input.direction === "followers"
          ? [userFollows.followingId, userFollows.followerId]
          : [userFollows.followerId, userFollows.followingId];

      return ctx.db
        .select({
          id: users.id,
          name: users.name,
          image: users.image,
          bio: users.bio,
          followedAt: userFollows.createdAt,
        })
        .from(userFollows)
        .innerJoin(users, eq(users.id, pickColumn))
        .where(eq(matchColumn, input.userId))
        .orderBy(desc(userFollows.createdAt))
        .limit(input.limit);
    }),

  /**
   * Bump `lastSeenAt`. Called by the app shell on a slow interval.
   *
   * Unconditional: the write happens whatever `showOnlineStatus` says, because
   * that switch governs *disclosure*, not collection, and flipping it back on
   * should not require waiting out a heartbeat before you look alive.
   */
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(users)
      .set({ lastSeenAt: new Date() })
      .where(eq(users.id, ctx.session.user.id));

    return { ok: true };
  }),
});
