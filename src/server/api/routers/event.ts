import { z } from "zod";
import { protectedProcedure, publicProcedure, createTRPCRouter } from "../trpc";
import {
  events,
  eventCoHosts,
  eventComments,
  eventLikes,
  eventRsvps,
  eventSaves,
  userFollows,
  users,
} from "~/server/db/schema";
import { eq, desc, asc, and, or, sql, inArray, gte, type SQL } from "drizzle-orm";
import { type NewEvent } from "~/server/db/schema";
import type { db as Database } from "~/server/db";
import { TRPCError } from "@trpc/server";
import {
  emitEventCreated,
  emitEventDeleted,
  emitEventUpdated,
} from "~/server/ws/emit";
import { notify, notifyMany } from "~/server/notifications/dispatch";
import { eventSubscribers } from "~/server/notifications/audience";

/**
 * How an RSVP reads to the person who owns the event.
 *
 * A decline is worth telling the owner about — it changes their headcount — but
 * it is framed as information rather than as good news.
 */
const RSVP_TITLES: Record<"going" | "maybe" | "not_going", string> = {
  going: "New attendee",
  maybe: "A tentative reply",
  not_going: "Someone can't make it",
};

const RSVP_PHRASES: Record<"going" | "maybe" | "not_going", string> = {
  going: "is going to",
  maybe: "might attend",
  not_going: "can't make",
};

/** The ten towns the region enum knows. */
const REGION_VALUES = [
  "sofia", "plovdiv", "varna", "burgas", "ruse",
  "stara_zagora", "pleven", "sliven", "dobrich", "shumen",
] as const;

const COVER_VALUES = [
  "dusk", "ember", "meadow", "blush", "sand", "tide",
] as const;

const TOPIC_VALUES = [
  "tech", "music", "food", "sport", "art", "business", "education", "community",
] as const;

/**
 * The ways into the feed.
 *
 * `past` is the only one that reverses time, which is why it is a view rather
 * than a band: every other view reads forwards from now, and mixing the two
 * orderings in one list is what made the old feed impossible to page.
 */
const FEED_VIEWS = ["all", "going", "maybe", "hosting", "saved", "past"] as const;

/** Whose events: the people you chose, or everyone. */
const FEED_SOURCES = ["following", "discover"] as const;

/**
 * When an event stops being upcoming.
 *
 * `ends_at` is null for every row written before it existed, so this reads as
 * the start time in that case — which is exactly the old behaviour, and the
 * reason a three-day conference no longer files itself under "past" on its
 * opening morning.
 */
const eventEndsAt = sql`COALESCE(${events.endsAt}, ${events.eventDate})`;

/**
 * A timestamp, bound as one.
 *
 * Inside a raw `sql` template a `Date` never reaches drizzle's column mapper —
 * it goes straight to postgres-js, which cannot infer a type for it and throws
 * ("Received an instance of Date") the moment the statement is bound. An ISO
 * string with an explicit cast is unambiguous to both.
 */
function ts(value: Date) {
  return sql`${value.toISOString()}::timestamptz`;
}

/** The ids of everyone `userId` follows, as a scalar subquery. */
function followingIds(userId: string) {
  return sql`(SELECT ${userFollows.followingId} FROM ${userFollows} WHERE ${userFollows.followerId} = ${userId})`;
}

const createEventSchema = z.object({
  title: z.string().min(1, "Title is required").max(256),
  description: z.string().min(1, "Description is required").max(5000),
  eventDate: z.date(),
  endsAt: z.date().nullish(),
  region: z.enum(REGION_VALUES),
  venue: z.string().max(160).nullish(),
  address: z.string().max(255).nullish(),
  capacity: z.number().int().min(1).max(1_000_000).nullish(),
  topic: z.enum(TOPIC_VALUES).nullish(),
  coverTheme: z.enum(COVER_VALUES).nullish(),
  imageUrl: z.string().url().optional(),
  enableRsvp: z.boolean().default(false),
  sendReminders: z.boolean().default(false),
  /** Co-hosts get the host's edit rights; the creator keeps deletion. */
  coHostIds: z.array(z.string().min(1)).max(10).optional(),
}).refine(
  (data) => !data.endsAt || data.endsAt.getTime() >= data.eventDate.getTime(),
  { message: "An event cannot end before it starts", path: ["endsAt"] },
);

const addCommentSchema = z.object({
  eventId: z.number(),
  text: z.string().max(500),
  imageUrl: z.string().url().optional(),
  /** Replying to a comment. A reply to a reply re-parents to its top level. */
  parentId: z.number().int().nullish(),
}).refine(
  (data) => data.text.trim().length > 0 || data.imageUrl !== undefined,
  { message: "Comment must have either text or an image" }
);

const toggleLikeSchema = z.object({
  eventId: z.number(),
});

const updateRsvpSchema = z.object({
  eventId: z.number(),
  status: z.enum(["going", "maybe", "not_going"]),
  reminderMinutesBefore: z.number().int().min(0).nullable().optional(),
});

const deleteEventSchema = z.object({
  eventId: z.number(),
});

const updateEventSchema = z.object({
  eventId: z.number(),
  title: z.string().min(1, "Title is required").max(256).optional(),
  description: z.string().min(1, "Description is required").max(5000).optional(),
  eventDate: z.date().optional(),
  endsAt: z.date().nullish(),
  region: z.enum(REGION_VALUES).optional(),
  venue: z.string().max(160).nullish(),
  address: z.string().max(255).nullish(),
  capacity: z.number().int().min(1).max(1_000_000).nullish(),
  topic: z.enum(TOPIC_VALUES).nullish(),
  coverTheme: z.enum(COVER_VALUES).nullish(),
  imageUrl: z.string().url().optional().nullable(),
  enableRsvp: z.boolean().optional(),
  sendReminders: z.boolean().optional(),
  coHostIds: z.array(z.string().min(1)).max(10).optional(),
});

const feedInputSchema = z
  .object({
    source: z.enum(FEED_SOURCES).default("discover"),
    view: z.enum(FEED_VIEWS).default("all"),
    /** `null` or absent means every region. */
    region: z.enum(REGION_VALUES).nullish(),
    topic: z.enum(TOPIC_VALUES).nullish(),
    query: z.string().max(120).nullish(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z
      .object({ eventDate: z.date(), id: z.number().int() })
      .nullish(),
  })
  .optional();

const sendRemindersSchema = z.void();

/**
 * One page of a comment thread.
 *
 * Top-level comments newest first, each carrying its first few replies and a
 * count of the rest. Two queries whatever the page size — the replies are
 * fetched for the whole page of parents at once, never per comment.
 *
 * The feed used to do none of this: it selected *every* comment for *every*
 * event on the page with no limit at all, shipped them to the browser, and
 * rendered two.
 */
async function loadCommentPage(
  db: typeof Database,
  eventId: number,
  options: { limit?: number; before?: Date | null; repliesPerComment?: number } = {},
) {
  const limit = options.limit ?? 10;
  const repliesPerComment = options.repliesPerComment ?? 3;

  const parents = await db
    .select({
      id: eventComments.id,
      text: eventComments.text,
      imageUrl: eventComments.imageUrl,
      createdAt: eventComments.createdAt,
      authorId: users.id,
      authorName: users.name,
      authorImage: users.image,
      replyCount:
        sql<number>`(SELECT count(*) FROM ${eventComments} AS replies WHERE replies.parent_id = ${eventComments.id})`.mapWith(
          Number,
        ),
    })
    .from(eventComments)
    .leftJoin(users, eq(users.id, eventComments.createdById))
    .where(
      and(
        eq(eventComments.eventId, eventId),
        sql`${eventComments.parentId} IS NULL`,
        options.before ? sql`${eventComments.createdAt} < ${ts(options.before)}` : undefined,
      ),
    )
    .orderBy(desc(eventComments.createdAt), desc(eventComments.id))
    .limit(limit + 1);

  const pageParents = parents.slice(0, limit);
  const last = pageParents[pageParents.length - 1];
  const nextCursor = parents.length > limit && last ? last.createdAt : null;

  const parentIds = pageParents.map((row) => row.id);
  const repliesByParent = new Map<number, typeof pageParents>();

  if (parentIds.length > 0) {
    const replies = await db
      .select({
        id: eventComments.id,
        parentId: eventComments.parentId,
        text: eventComments.text,
        imageUrl: eventComments.imageUrl,
        createdAt: eventComments.createdAt,
        authorId: users.id,
        authorName: users.name,
        authorImage: users.image,
      })
      .from(eventComments)
      .leftJoin(users, eq(users.id, eventComments.createdById))
      .where(inArray(eventComments.parentId, parentIds))
      .orderBy(asc(eventComments.parentId), asc(eventComments.createdAt))
      .limit(parentIds.length * repliesPerComment);

    for (const reply of replies) {
      if (reply.parentId === null) continue;
      const bucket = repliesByParent.get(reply.parentId) ?? [];
      if (bucket.length < repliesPerComment) {
        bucket.push(reply as unknown as (typeof pageParents)[number]);
        repliesByParent.set(reply.parentId, bucket);
      }
    }
  }

  const shape = (row: {
    id: number;
    text: string;
    imageUrl: string | null;
    createdAt: Date;
    authorId: string | null;
    authorName: string | null;
    authorImage: string | null;
  }) => ({
    id: row.id,
    text: row.text,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt,
    author: { id: row.authorId, name: row.authorName, image: row.authorImage },
  });

  return {
    items: pageParents.map((row) => ({
      ...shape(row),
      replyCount: row.replyCount,
      replies: (repliesByParent.get(row.id) ?? []).map(shape),
    })),
    nextCursor,
  };
}

export const eventRouter = createTRPCRouter({
  createEvent: protectedProcedure
    .input(createEventSchema)
    .mutation(async ({ ctx, input }) => {
      const { coHostIds, ...fields } = input;
      const createdById = ctx.session.user.id;

      if (!fields.region) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Region is required",
        });
      }

      const newEvent: NewEvent = {
        title: fields.title,
        description: fields.description,
        eventDate: fields.eventDate,
        endsAt: fields.endsAt ?? null,
        region: fields.region,
        venue: fields.venue ?? null,
        address: fields.address ?? null,
        capacity: fields.capacity ?? null,
        topic: fields.topic ?? null,
        coverTheme: fields.coverTheme ?? null,
        imageUrl: fields.imageUrl ?? null,
        createdById,
        enableRsvp: fields.enableRsvp,
        sendReminders: fields.sendReminders,
      };

      const [created] = await ctx.db
        .insert(events)
        .values(newEvent)
        .returning({ id: events.id });

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The event could not be created.",
        });
      }

      /* Co-hosts, minus the creator: being your own co-host is a row that can
         only ever confuse the page and the edit check. */
      const invited = [...new Set(coHostIds ?? [])].filter(
        (id) => id !== createdById,
      );
      if (invited.length > 0) {
        await ctx.db
          .insert(eventCoHosts)
          .values(invited.map((userId) => ({ eventId: created.id, userId })))
          .onConflictDoNothing();

        await notifyMany({
          db: ctx.db,
          userIds: invited,
          actorId: createdById,
          category: "eventUpdate",
          type: "event",
          title: "You are co-hosting an event",
          message: `You were added as a co-host of "${fields.title}".`,
          link: `/events/${created.id}`,
        });
      }

      /* The one moment a live feed exists for, and the one moment that used to
         emit nothing. Followers of this host can now see it arrive. */
      emitEventCreated({ eventId: created.id, hostId: createdById });

      return { success: true, eventId: created.id };
    }),

  /**
   * The feed, in two lanes.
   *
   * `getPublicEvents` used to be this, and it made one decision for everybody:
   * order by creation, newest first, and hand the client every row so it could
   * filter them in the browser. That is a bulletin board. This procedure takes
   * the source (`following` reads the follow graph, `discover` reads everything
   * else), applies the view, region, topic and search server-side, and orders
   * forward through time rather than backwards through creation — because what
   * a person wants from an events feed is what is about to happen, not what was
   * most recently typed.
   *
   * Two consequences worth knowing:
   *
   * - `past` is a view, not a band. It is the one direction that reverses the
   *   ordering, and mixing both in one list is what made the old feed
   *   impossible to page.
   * - Comments no longer ship with the feed. They were fetched unbounded for
   *   every event on the page and rendered two at a time; they live on the
   *   event page now, behind `getComments`.
   */
  getFeed: publicProcedure
    .input(feedInputSchema)
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.session?.user?.id ?? null;
      const limit = input?.limit ?? 8;
      const view = input?.view ?? "all";
      const asked = input?.source ?? "discover";
      const isPast = view === "past";
      const now = new Date();

      /**
       * One page, for one lane.
       *
       * A closure rather than a module-level helper so it keeps `ctx`, `input`
       * and the viewer without threading them through a signature — and so the
       * caller below can simply run it twice.
       */
      const readPage = async (candidate: (typeof FEED_SOURCES)[number]) => {
      const conditions: (SQL | undefined)[] = [
        isPast ? sql`${eventEndsAt} < ${ts(now)}` : sql`${eventEndsAt} >= ${ts(now)}`,
      ];

      if (input?.region) conditions.push(eq(events.region, input.region));
      if (input?.topic) conditions.push(eq(events.topic, input.topic));

      const needle = input?.query?.trim();
      if (needle) {
        const pattern = `%${needle}%`;
        conditions.push(sql`(
          ${events.title} ILIKE ${pattern}
          OR ${events.description} ILIKE ${pattern}
          OR ${events.venue} ILIKE ${pattern}
          OR ${users.name} ILIKE ${pattern}
        )`);
      }

      /* The views that are about you. Signed out, each of them is empty rather
         than unfiltered — "events I am going to" with no viewer is not the
         whole feed, it is nothing. */
      if (view === "going" || view === "maybe") {
        conditions.push(
          viewerId
            ? sql`EXISTS(SELECT 1 FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.userId} = ${viewerId} AND ${eventRsvps.status} = ${view})`
            : sql`false`,
        );
      }
      if (view === "hosting") {
        conditions.push(
          viewerId
            ? sql`(${events.createdById} = ${viewerId} OR EXISTS(SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${viewerId}))`
            : sql`false`,
        );
      }
      if (view === "saved") {
        conditions.push(
          viewerId
            ? sql`EXISTS(SELECT 1 FROM ${eventSaves} WHERE ${eventSaves.eventId} = ${events.id} AND ${eventSaves.userId} = ${viewerId})`
            : sql`false`,
        );
      }

      /* Following: yours, or somebody's you follow.
         Hosted or co-hosted by someone you follow, attended by someone you
         follow — that third clause is what makes the lane worth reading, since
         it surfaces events from people you have never heard of because people
         you trust are going — and your own, because the first feed a host
         checks is the one their own event is supposed to be in. */
      if (candidate === "following") {
        conditions.push(
          viewerId
            ? sql`(
                ${events.createdById} = ${viewerId}
                OR EXISTS(SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${viewerId})
                OR ${events.createdById} IN ${followingIds(viewerId)}
                OR EXISTS(SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} IN ${followingIds(viewerId)})
                OR EXISTS(SELECT 1 FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.status} IN ('going','maybe') AND ${eventRsvps.userId} IN ${followingIds(viewerId)})
              )`
            : sql`false`,
        );
      }

      if (input?.cursor) {
        const { eventDate, id } = input.cursor;
        conditions.push(
          isPast
            ? sql`(${events.eventDate} < ${ts(eventDate)} OR (${events.eventDate} = ${ts(eventDate)} AND ${events.id} < ${id}))`
            : sql`(${events.eventDate} > ${ts(eventDate)} OR (${events.eventDate} = ${ts(eventDate)} AND ${events.id} > ${id}))`,
        );
      }

      const rows = await ctx.db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          eventDate: events.eventDate,
          endsAt: events.endsAt,
          region: events.region,
          venue: events.venue,
          address: events.address,
          capacity: events.capacity,
          topic: events.topic,
          coverTheme: events.coverTheme,
          imageUrl: events.imageUrl,
          createdAt: events.createdAt,
          updatedAt: events.updatedAt,
          createdById: events.createdById,
          enableRsvp: events.enableRsvp,

          authorId: users.id,
          authorName: users.name,
          authorImage: users.image,

          commentCount:
            sql<number>`(SELECT count(*) FROM ${eventComments} WHERE ${eventComments.eventId} = ${events.id})`.mapWith(
              Number,
            ),
          likeCount:
            sql<number>`(SELECT count(*) FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id})`.mapWith(
              Number,
            ),

          hasLiked: viewerId
            ? sql<boolean>`EXISTS(SELECT 1 FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id} AND ${eventLikes.createdById} = ${viewerId})`
            : sql<boolean>`false`,
          hasSaved: viewerId
            ? sql<boolean>`EXISTS(SELECT 1 FROM ${eventSaves} WHERE ${eventSaves.eventId} = ${events.id} AND ${eventSaves.userId} = ${viewerId})`
            : sql<boolean>`false`,
          userRsvpStatus: viewerId
            ? sql<string>`(SELECT status FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.userId} = ${viewerId})`
            : sql<null>`null`,
          viewerFollowsAuthor: viewerId
            ? sql<boolean>`EXISTS(SELECT 1 FROM ${userFollows} WHERE ${userFollows.followerId} = ${viewerId} AND ${userFollows.followingId} = ${events.createdById})`
            : sql<boolean>`false`,
          /* Co-hosts may edit, so ownership alone no longer decides who sees
             the pencil. */
          viewerCanEdit: viewerId
            ? sql<boolean>`(${events.createdById} = ${viewerId} OR EXISTS(SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${viewerId}))`
            : sql<boolean>`false`,

          rsvpGoing:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'going')`.mapWith(
              Number,
            ),
          rsvpMaybe:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'maybe')`.mapWith(
              Number,
            ),
          rsvpNotGoing:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'not_going')`.mapWith(
              Number,
            ),

          /* How many people you follow are going. Exact — it is the number the
             reason line quotes, so a correlated count rather than something
             derived from whatever names happened to fit in the query below. */
          followedGoingCount: viewerId
            ? sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.status} IN ('going','maybe') AND ${eventRsvps.userId} IN ${followingIds(viewerId)})`.mapWith(
                Number,
              )
            : sql<number>`0`.mapWith(Number),
        })
        .from(events)
        .leftJoin(users, eq(events.createdById, users.id))
        .where(and(...conditions))
        .orderBy(
          isPast ? desc(events.eventDate) : asc(events.eventDate),
          isPast ? desc(events.id) : asc(events.id),
        )
        .limit(limit + 1);

      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      const nextCursor =
        rows.length > limit && last
          ? { eventDate: last.eventDate, id: last.id }
          : null;

      return { pageRows, nextCursor };
      };

      /**
       * An empty Following lane falls back to Discover.
       *
       * Following nobody yet is the *normal* first state of this feature, not
       * an edge case — and landing somebody on an empty screen is how a feed
       * teaches people it is broken. Only the first page falls back: paging
       * forward past the end of a lane you chose should end, not switch lanes
       * under you.
       */
      let usedSource = asked;
      let { pageRows, nextCursor } = await readPage(asked);

      if (asked === "following" && pageRows.length === 0 && !input?.cursor) {
        ({ pageRows, nextCursor } = await readPage("discover"));
        usedSource = "discover";
      }

      /**
       * One name per event for the reason line.
       *
       * Best-effort by design: the count above is exact, this is only the name
       * that fronts it. Bounding the fetch means an event with two hundred
       * followed attendees cannot make this query grow with the follow graph,
       * and a row that misses out simply reads "4 people you follow are going".
       */
      const eventIds = pageRows.map((row) => row.id);
      const followedNames = new Map<number, string>();
      if (viewerId && eventIds.length > 0) {
        const attendees = await ctx.db
          .select({ eventId: eventRsvps.eventId, name: users.name })
          .from(eventRsvps)
          .innerJoin(users, eq(users.id, eventRsvps.userId))
          .where(
            and(
              inArray(eventRsvps.eventId, eventIds),
              inArray(eventRsvps.status, ["going", "maybe"]),
              sql`${eventRsvps.userId} IN ${followingIds(viewerId)}`,
            ),
          )
          .orderBy(asc(eventRsvps.eventId), asc(eventRsvps.createdAt))
          .limit(eventIds.length * 4);

        for (const row of attendees) {
          if (row.name && !followedNames.has(row.eventId)) {
            followedNames.set(row.eventId, row.name);
          }
        }
      }

      /**
       * Three faces per event for the attendance line.
       *
       * The card says "Pavel, Гери and 34 others are going", which needs names
       * and avatars the counts alone cannot give. Bounded the same way as the
       * reason-line lookup above: the exact number comes from `rsvpCounts`, and
       * a row whose faces did not fit simply reads "36 going".
       *
       * People the viewer follows are pulled to the front, so the two faces you
       * recognise are the two you see.
       */
      const facesByEvent = new Map<
        number,
        { id: string; name: string | null; image: string | null }[]
      >();
      if (eventIds.length > 0) {
        const faces = await ctx.db
          .select({
            eventId: eventRsvps.eventId,
            id: users.id,
            name: users.name,
            image: users.image,
            isFollowed: viewerId
              ? sql<boolean>`${eventRsvps.userId} IN ${followingIds(viewerId)}`
              : sql<boolean>`false`,
          })
          .from(eventRsvps)
          .innerJoin(users, eq(users.id, eventRsvps.userId))
          .where(
            and(
              inArray(eventRsvps.eventId, eventIds),
              eq(eventRsvps.status, "going"),
            ),
          )
          .orderBy(asc(eventRsvps.eventId), desc(eventRsvps.createdAt))
          .limit(eventIds.length * 6);

        for (const face of faces) {
          const bucket = facesByEvent.get(face.eventId) ?? [];
          if (face.isFollowed) bucket.unshift(face);
          else bucket.push(face);
          facesByEvent.set(face.eventId, bucket.slice(0, 3));
        }
      }

      const items = pageRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        eventDate: row.eventDate,
        endsAt: row.endsAt,
        region: row.region,
        venue: row.venue,
        address: row.address,
        capacity: row.capacity,
        topic: row.topic,
        coverTheme: row.coverTheme,
        imageUrl: row.imageUrl,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        createdById: row.createdById,
        enableRsvp: row.enableRsvp,
        commentCount: row.commentCount,
        likeCount: row.likeCount,
        hasLiked: row.hasLiked,
        hasSaved: row.hasSaved,
        userRsvpStatus: row.userRsvpStatus as
          | "going"
          | "maybe"
          | "not_going"
          | null,
        viewerFollowsAuthor: row.viewerFollowsAuthor,
        viewerCanEdit: row.viewerCanEdit,
        author: {
          id: row.authorId,
          name: row.authorName,
          image: row.authorImage,
        },
        rsvpCounts: {
          going: row.rsvpGoing,
          maybe: row.rsvpMaybe,
          notGoing: row.rsvpNotGoing,
        },
        /** Up to three of the people going, for the attendance line. */
        attendees: facesByEvent.get(row.id) ?? [],
        /** Why this row is in front of you. `null` means "no reason but time". */
        reason:
          viewerId && row.createdById === viewerId
            ? ({ kind: "hosting" } as const)
            : row.viewerFollowsAuthor
              ? ({ kind: "followedHost", name: row.authorName } as const)
              : row.followedGoingCount > 0
                ? ({
                    kind: "followedGoing",
                    count: row.followedGoingCount,
                    name: followedNames.get(row.id) ?? null,
                  } as const)
                : null,
      }));

      return { items, nextCursor, usedSource };
    }),

  /**
   * How many upcoming events sit behind each filter chip.
   *
   * The rail used to count the rows the browser happened to have loaded, which
   * with a paged feed means it was counting a screenful. These are counts over
   * the table, so "Varna 24" is true rather than "24 of the ones you scrolled
   * past". Region and topic are each counted *ignoring themselves*, so picking
   * Varna does not collapse every other town to zero.
   */
  getFacets: publicProcedure
    .input(
      z
        .object({
          source: z.enum(FEED_SOURCES).default("discover"),
          query: z.string().max(120).nullish(),
          region: z.enum(REGION_VALUES).nullish(),
          topic: z.enum(TOPIC_VALUES).nullish(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.session?.user?.id ?? null;
      const now = new Date();
      const source = input?.source ?? "discover";

      const base: (SQL | undefined)[] = [sql`${eventEndsAt} >= ${ts(now)}`];

      const needle = input?.query?.trim();
      if (needle) {
        const pattern = `%${needle}%`;
        base.push(sql`(${events.title} ILIKE ${pattern} OR ${events.description} ILIKE ${pattern} OR ${events.venue} ILIKE ${pattern})`);
      }

      if (source === "following") {
        base.push(
          viewerId
            ? sql`(
                ${events.createdById} IN ${followingIds(viewerId)}
                OR EXISTS(SELECT 1 FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.status} IN ('going','maybe') AND ${eventRsvps.userId} IN ${followingIds(viewerId)})
              )`
            : sql`false`,
        );
      }

      const regionRows = await ctx.db
        .select({
          region: events.region,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(events)
        .where(
          and(
            ...base,
            input?.topic ? eq(events.topic, input.topic) : undefined,
          ),
        )
        .groupBy(events.region);

      const topicRows = await ctx.db
        .select({
          topic: events.topic,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(events)
        .where(
          and(
            ...base,
            input?.region ? eq(events.region, input.region) : undefined,
          ),
        )
        .groupBy(events.topic);

      const regions: Record<string, number> = {};
      for (const row of regionRows) regions[row.region] = row.count;

      const topics: Record<string, number> = {};
      let total = 0;
      for (const row of topicRows) {
        total += row.count;
        if (row.topic) topics[row.topic] = row.count;
      }

      return { regions, topics, total };
    }),

  /**
   * Everything the publish sidebar needs about *you*, in one round trip.
   *
   * The feed is paginated, so counting your own RSVPs from the loaded pages
   * would report "3 going" simply because page two had not arrived yet. These
   * counts are over the whole table; the agenda is the next few things you have
   * said yes to, host or guest, soonest first.
   */
  getMySummary: protectedProcedure.query(async ({ ctx }) => {
    const currentUserId = ctx.session.user.id;
    const now = new Date();

    /* Counted over the whole table, not the loaded page. `hosting` includes
       events you co-host, because the rail row you press filters on both. */
    const [counts] = await ctx.db
      .select({
        hosting: sql<number>`count(*) FILTER (WHERE ${events.createdById} = ${currentUserId} OR EXISTS(SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${currentUserId}))`.mapWith(Number),
        going: sql<number>`count(*) FILTER (WHERE ${eventRsvps.status} = 'going')`.mapWith(Number),
        maybe: sql<number>`count(*) FILTER (WHERE ${eventRsvps.status} = 'maybe')`.mapWith(Number),
        saved: sql<number>`count(*) FILTER (WHERE EXISTS(SELECT 1 FROM ${eventSaves} WHERE ${eventSaves.eventId} = ${events.id} AND ${eventSaves.userId} = ${currentUserId}))`.mapWith(Number),
        past: sql<number>`count(*) FILTER (WHERE ${eventEndsAt} < ${ts(now)})`.mapWith(Number),
        /* Not about events at all, but the identity card in the rail reads them
           and one round trip beats two. */
        followers: sql<number>`(SELECT count(*) FROM ${userFollows} WHERE ${userFollows.followingId} = ${currentUserId})`.mapWith(Number),
        following: sql<number>`(SELECT count(*) FROM ${userFollows} WHERE ${userFollows.followerId} = ${currentUserId})`.mapWith(Number),
      })
      .from(events)
      .leftJoin(
        eventRsvps,
        and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.userId, currentUserId)),
      );

    const agenda = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
        region: events.region,
        isHost: sql<boolean>`${events.createdById} = ${currentUserId}`,
        rsvpStatus: eventRsvps.status,
      })
      .from(events)
      .leftJoin(
        eventRsvps,
        and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.userId, currentUserId)),
      )
      .where(
        and(
          gte(events.eventDate, now),
          or(
            eq(events.createdById, currentUserId),
            inArray(eventRsvps.status, ["going", "maybe"]),
          ),
        ),
      )
      .orderBy(asc(events.eventDate))
      .limit(5);

    return {
      counts: {
        hosting: counts?.hosting ?? 0,
        going: counts?.going ?? 0,
        maybe: counts?.maybe ?? 0,
        saved: counts?.saved ?? 0,
        past: counts?.past ?? 0,
        followers: counts?.followers ?? 0,
        following: counts?.following ?? 0,
      },
      agenda: agenda.map((row) => ({
        id: row.id,
        title: row.title,
        eventDate: row.eventDate,
        region: row.region,
        isHost: row.isHost,
        rsvpStatus: row.rsvpStatus,
      })),
    };
  }),

  addComment: protectedProcedure
    .input(addCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;

      /* A reply to a reply hangs under the same top-level comment, so a thread
         is always exactly two deep and rendering never recurses. */
      let parentId: number | null = null;
      if (input.parentId) {
        const [parent] = await ctx.db
          .select({ id: eventComments.id, parentId: eventComments.parentId, eventId: eventComments.eventId })
          .from(eventComments)
          .where(eq(eventComments.id, input.parentId))
          .limit(1);

        if (!parent || parent.eventId !== input.eventId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That comment is not on this event.",
          });
        }
        parentId = parent.parentId ?? parent.id;
      }

      await ctx.db.insert(eventComments).values({
        eventId: input.eventId,
        text: input.text,
        imageUrl: input.imageUrl,
        parentId,
        createdById: currentUserId,
      });

      // Notify event owner about the comment (unless they're the commenter)
      const [eventRow] = await ctx.db
        .select({ createdById: events.createdById, title: events.title })
        .from(events)
        .where(eq(events.id, input.eventId))
        .limit(1);

      if (eventRow && eventRow.createdById !== currentUserId) {
        const commenter = await ctx.db.query.users.findFirst({
          where: eq(users.id, currentUserId),
          columns: { name: true },
        });
        const commenterName = commenter?.name ?? "Someone";

        await notify({
          db: ctx.db,
          userId: eventRow.createdById,
          actorId: currentUserId,
          category: "social",
          type: "comment",
          title: "New comment on your event",
          message: `${commenterName} commented on "${eventRow.title}"`,
          link: `/events/${input.eventId}`,
        });
      }

      // Real-time update for all clients viewing the event feed
      emitEventUpdated(input.eventId);

      return { success: true };
    }),

  toggleLike: protectedProcedure
    .input(toggleLikeSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;

      // Direct check without transaction for speed
      const existingLike = await ctx.db
        .select()
        .from(eventLikes)
        .where(
          and(
            eq(eventLikes.eventId, input.eventId),
            eq(eventLikes.createdById, currentUserId)
          )
        )
        .limit(1);

      if (existingLike.length > 0) {
        await ctx.db
          .delete(eventLikes)
          .where(
            and(
              eq(eventLikes.eventId, input.eventId),
              eq(eventLikes.createdById, currentUserId)
            )
          );
        emitEventUpdated(input.eventId);
        return { action: 'unliked', hasLiked: false };
      } else {
        await ctx.db.insert(eventLikes).values({
          eventId: input.eventId,
          createdById: currentUserId,
        });

        // Notify event owner about the like (unless they liked their own post)
        const [eventRow] = await ctx.db
          .select({ createdById: events.createdById, title: events.title })
          .from(events)
          .where(eq(events.id, input.eventId))
          .limit(1);

        if (eventRow && eventRow.createdById !== currentUserId) {
          const liker = await ctx.db.query.users.findFirst({
            where: eq(users.id, currentUserId),
            columns: { name: true },
          });
          const likerName = liker?.name ?? "Someone";

          await notify({
            db: ctx.db,
            userId: eventRow.createdById,
            actorId: currentUserId,
            category: "social",
            type: "like",
            title: "New like on your event",
            message: `${likerName} liked your event "${eventRow.title}"`,
            link: `/events/${input.eventId}`,
            // Likes arrive in bursts on a popular post; one bell entry per
            // unread window is enough to make the point.
            coalesceWindowMs: 10 * 60 * 1000,
          });
        }

        emitEventUpdated(input.eventId);
        return { action: 'liked', hasLiked: true };
      }
    }),

  updateRsvp: protectedProcedure
    .input(updateRsvpSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;

      // Direct check without findFirst for speed
      const existingRsvp = await ctx.db
        .select()
        .from(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, input.eventId),
            eq(eventRsvps.userId, currentUserId)
          )
        )
        .limit(1);

      const previousStatus = existingRsvp[0]?.status ?? null;

      if (existingRsvp.length > 0) {
        await ctx.db
          .update(eventRsvps)
          .set({ 
            status: input.status,
            updatedAt: new Date(),
            ...(input.reminderMinutesBefore !== undefined
              ? {
                  reminderMinutesBefore: input.reminderMinutesBefore,
                  reminderSent: false,
                }
              : {}),
          })
          .where(
            and(
              eq(eventRsvps.eventId, input.eventId),
              eq(eventRsvps.userId, currentUserId)
            )
          );
      } else {
        await ctx.db.insert(eventRsvps).values({
          eventId: input.eventId,
          userId: currentUserId,
          status: input.status,
          reminderMinutesBefore: input.reminderMinutesBefore ?? null,
          reminderSent: false,
          updatedAt: new Date(),
        });
      }

      /* Subscribing to an event told nobody anything. The owner had no way to
         learn that someone had signed up, and the subscriber's own reminder
         request was recorded and never acted on — see the reminder sweep in
         `~/server/notifications/eventReminders` for the second half of that.

         Only a *new* or *changed* RSVP is news. Re-saving the same status —
         which the RSVP dialog does whenever the reminder dropdown changes —
         must not notify again. */
      const statusChanged = previousStatus !== input.status;

      if (statusChanged) {
        const [eventRow] = await ctx.db
          .select({ createdById: events.createdById, title: events.title })
          .from(events)
          .where(eq(events.id, input.eventId))
          .limit(1);

        if (eventRow) {
          const responder = await ctx.db.query.users.findFirst({
            where: eq(users.id, currentUserId),
            columns: { name: true },
          });
          const responderName = responder?.name ?? "Someone";

          await notify({
            db: ctx.db,
            userId: eventRow.createdById,
            actorId: currentUserId,
            category: "eventRsvp",
            type: "event",
            title: RSVP_TITLES[input.status],
            message: `${responderName} ${RSVP_PHRASES[input.status]} "${eventRow.title}"`,
            link: `/events/${input.eventId}`,
          });
        }
      }

      emitEventUpdated(input.eventId);
      return { success: true, status: input.status };
    }),

  deleteEvent: protectedProcedure
    .input(deleteEventSchema)
    .mutation(async ({ ctx, input }) => {
      const [event] = await ctx.db
        .select({ id: events.id, createdById: events.createdById, title: events.title })
        .from(events)
        .where(eq(events.id, input.eventId))
        .limit(1);

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      if (event.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this event." });
      }

      /* Read the audience *before* the delete. The RSVP rows cascade away with
         the event, so asking afterwards always returns nobody — which is the
         trap that would make a cancellation the one change subscribers never
         hear about. */
      const subscribers = await eventSubscribers(ctx.db, input.eventId);
      const title = event.title;

      await ctx.db.delete(events).where(eq(events.id, input.eventId));

      await notifyMany({
        db: ctx.db,
        userIds: subscribers,
        actorId: ctx.session.user.id,
        category: "eventUpdate",
        type: "event",
        title: "Event cancelled",
        message: `"${title}" has been cancelled by the organiser.`,
        // No anchor: the event is gone, so a deep link would land on nothing.
        link: "/publish",
      });

      // Notify all connected clients about the deletion in real-time
      emitEventDeleted(input.eventId);

      return { success: true };
    }),

  updateEvent: protectedProcedure
    .input(updateEventSchema)
    .mutation(async ({ ctx, input }) => {
      const { eventId, ...updates } = input;

      const [event] = await ctx.db
        .select({
          id: events.id,
          createdById: events.createdById,
          title: events.title,
          eventDate: events.eventDate,
          region: events.region,
          isCoHost: sql<boolean>`EXISTS(SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${ctx.session.user.id})`,
        })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      /* Co-hosts may edit. They may not delete, and they may not change who the
         other co-hosts are — both of those stay with whoever created the row,
         so being added as a co-host can never cost somebody their event. */
      const isOwner = event.createdById === ctx.session.user.id;
      if (!isOwner && !event.isCoHost) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this event." });
      }

      if (updates.coHostIds !== undefined && !isOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the host can change who is co-hosting.",
        });
      }

      // Build update object with only defined fields
      const updateFields: Record<string, unknown> = {};
      if (updates.title !== undefined) updateFields.title = updates.title;
      if (updates.description !== undefined) updateFields.description = updates.description;
      if (updates.eventDate !== undefined) updateFields.eventDate = updates.eventDate;
      if (updates.endsAt !== undefined) updateFields.endsAt = updates.endsAt;
      if (updates.region !== undefined) updateFields.region = updates.region;
      if (updates.venue !== undefined) updateFields.venue = updates.venue;
      if (updates.address !== undefined) updateFields.address = updates.address;
      if (updates.capacity !== undefined) updateFields.capacity = updates.capacity;
      if (updates.topic !== undefined) updateFields.topic = updates.topic;
      if (updates.coverTheme !== undefined) updateFields.coverTheme = updates.coverTheme;
      if (updates.imageUrl !== undefined) updateFields.imageUrl = updates.imageUrl;
      if (updates.enableRsvp !== undefined) updateFields.enableRsvp = updates.enableRsvp;
      if (updates.sendReminders !== undefined) updateFields.sendReminders = updates.sendReminders;

      if (updates.coHostIds !== undefined && isOwner) {
        const wanted = [...new Set(updates.coHostIds)].filter(
          (id) => id !== event.createdById,
        );
        await ctx.db.delete(eventCoHosts).where(eq(eventCoHosts.eventId, eventId));
        if (wanted.length > 0) {
          await ctx.db
            .insert(eventCoHosts)
            .values(wanted.map((userId) => ({ eventId, userId })))
            .onConflictDoNothing();
        }
      }

      if (Object.keys(updateFields).length === 0) {
        emitEventUpdated(eventId);
        return { success: true };
      }

      /* Stamped here rather than on every write: co-host changes, and a save
         that turned out to change nothing, are not edits a guest should be told
         about. Everything that reaches this line is a change to what the event
         *is*. */
      updateFields.updatedAt = new Date();

      await ctx.db
        .update(events)
        .set(updateFields)
        .where(eq(events.id, eventId));

      /* Only material edits reach subscribers.
         A fixed typo in the description, or a swapped cover image, is not worth
         a notification to everyone who signed up. A moved date or a moved city
         is the whole reason a person wants to be told anything at all — and if
         the date moved, every armed reminder is now measured against the wrong
         moment, so they are re-armed below. */
      const dateMoved =
        updateFields.eventDate instanceof Date &&
        updateFields.eventDate.getTime() !== event.eventDate.getTime();
      const regionMoved =
        typeof updateFields.region === "string" && updateFields.region !== event.region;

      if (dateMoved || regionMoved) {
        if (dateMoved) {
          await ctx.db
            .update(eventRsvps)
            .set({ reminderSent: false })
            .where(eq(eventRsvps.eventId, eventId));
        }

        const changes = [
          dateMoved ? "a new date" : null,
          regionMoved ? "a new location" : null,
        ].filter(Boolean);

        await notifyMany({
          db: ctx.db,
          userIds: await eventSubscribers(ctx.db, eventId),
          actorId: ctx.session.user.id,
          category: "eventUpdate",
          type: "event",
          title: "Event updated",
          message: `"${event.title}" now has ${changes.join(" and ")}.`,
          link: `/events/${eventId}`,
        });
      }

      emitEventUpdated(eventId);

      return { success: true };
    }),
    
  /**
   * One event, everything the page needs, one round trip.
   *
   * `publicProcedure` on purpose. A host who cannot paste a link into a group
   * chat and have it open for people without accounts does not have an events
   * product, and every viewer-dependent field below degrades to its signed-out
   * value rather than throwing.
   */
  getById: publicProcedure
    .input(z.object({ eventId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.session?.user?.id ?? null;

      const [row] = await ctx.db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          eventDate: events.eventDate,
          endsAt: events.endsAt,
          region: events.region,
          venue: events.venue,
          address: events.address,
          capacity: events.capacity,
          topic: events.topic,
          coverTheme: events.coverTheme,
          imageUrl: events.imageUrl,
          createdAt: events.createdAt,
          updatedAt: events.updatedAt,
          createdById: events.createdById,
          enableRsvp: events.enableRsvp,

          authorId: users.id,
          authorName: users.name,
          authorImage: users.image,

          commentCount:
            sql<number>`(SELECT count(*) FROM ${eventComments} WHERE ${eventComments.eventId} = ${events.id})`.mapWith(
              Number,
            ),
          likeCount:
            sql<number>`(SELECT count(*) FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id})`.mapWith(
              Number,
            ),
          hasLiked: viewerId
            ? sql<boolean>`EXISTS(SELECT 1 FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id} AND ${eventLikes.createdById} = ${viewerId})`
            : sql<boolean>`false`,
          hasSaved: viewerId
            ? sql<boolean>`EXISTS(SELECT 1 FROM ${eventSaves} WHERE ${eventSaves.eventId} = ${events.id} AND ${eventSaves.userId} = ${viewerId})`
            : sql<boolean>`false`,
          userRsvpStatus: viewerId
            ? sql<string>`(SELECT status FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.userId} = ${viewerId})`
            : sql<null>`null`,
          viewerFollowsAuthor: viewerId
            ? sql<boolean>`EXISTS(SELECT 1 FROM ${userFollows} WHERE ${userFollows.followerId} = ${viewerId} AND ${userFollows.followingId} = ${events.createdById})`
            : sql<boolean>`false`,
          authorFollowerCount:
            sql<number>`(SELECT count(*) FROM ${userFollows} WHERE ${userFollows.followingId} = ${events.createdById})`.mapWith(
              Number,
            ),
          rsvpGoing:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'going')`.mapWith(
              Number,
            ),
          rsvpMaybe:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'maybe')`.mapWith(
              Number,
            ),
          rsvpNotGoing:
            sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'not_going')`.mapWith(
              Number,
            ),
          reminderMinutesBefore: viewerId
            ? sql<number | null>`(SELECT reminder_minutes_before FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND ${eventRsvps.userId} = ${viewerId})`
            : sql<null>`null`,
        })
        .from(events)
        .leftJoin(users, eq(events.createdById, users.id))
        .where(eq(events.id, input.eventId))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      /* Counted separately rather than as a correlated self-join: an aliased
         subquery would have to spell the column name by hand, and this table
         does not use the naming convention that guess would assume. */
      const [authorTotals] = await ctx.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(events)
        .where(eq(events.createdById, row.createdById));

      const coHosts = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          image: users.image,
        })
        .from(eventCoHosts)
        .innerJoin(users, eq(users.id, eventCoHosts.userId))
        .where(eq(eventCoHosts.eventId, input.eventId))
        .orderBy(asc(eventCoHosts.createdAt))
        .limit(10);

      const comments = await loadCommentPage(ctx.db, input.eventId);

      const canEdit =
        !!viewerId &&
        (row.createdById === viewerId ||
          coHosts.some((host) => host.id === viewerId));

      return {
        event: {
          id: row.id,
          title: row.title,
          description: row.description,
          eventDate: row.eventDate,
          endsAt: row.endsAt,
          region: row.region,
          venue: row.venue,
          address: row.address,
          capacity: row.capacity,
          topic: row.topic,
          coverTheme: row.coverTheme,
          imageUrl: row.imageUrl,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          createdById: row.createdById,
          enableRsvp: row.enableRsvp,
          commentCount: row.commentCount,
          likeCount: row.likeCount,
          hasLiked: row.hasLiked,
          hasSaved: row.hasSaved,
          userRsvpStatus: row.userRsvpStatus as
            | "going"
            | "maybe"
            | "not_going"
            | null,
          reminderMinutesBefore: row.reminderMinutesBefore,
          rsvpCounts: {
            going: row.rsvpGoing,
            maybe: row.rsvpMaybe,
            notGoing: row.rsvpNotGoing,
          },
          author: {
            id: row.authorId,
            name: row.authorName,
            image: row.authorImage,
            followerCount: row.authorFollowerCount,
            eventCount: authorTotals?.count ?? 0,
          },
          viewerFollowsAuthor: row.viewerFollowsAuthor,
          coHosts,
          canEdit,
          isOwner: !!viewerId && row.createdById === viewerId,
        },
        comments,
      };
    }),

  /** Later pages of a thread. The first arrives with `getById`. */
  getComments: publicProcedure
    .input(
      z.object({
        eventId: z.number().int(),
        cursor: z.date().nullish(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      loadCommentPage(ctx.db, input.eventId, {
        limit: input.limit,
        before: input.cursor,
      }),
    ),

  /**
   * Who is coming.
   *
   * Open to guests, not just the host. Name and avatar only, which is exactly
   * what `resolveProfileAccess` calls the `minimal` level and what the viewer
   * can already see on the card — a restricted profile is not further exposed
   * by appearing in a list of people going somewhere public.
   */
  getAttendees: publicProcedure
    .input(
      z.object({
        eventId: z.number().int(),
        status: z.enum(["going", "maybe", "not_going"]).default("going"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          image: users.image,
          respondedAt: eventRsvps.updatedAt,
        })
        .from(eventRsvps)
        .innerJoin(users, eq(users.id, eventRsvps.userId))
        .where(
          and(
            eq(eventRsvps.eventId, input.eventId),
            eq(eventRsvps.status, input.status),
          ),
        )
        .orderBy(asc(eventRsvps.createdAt))
        .limit(input.limit ?? 40);

      return rows;
    }),

  /**
   * Bookmarking, which is not attending.
   *
   * Mirrors `toggleLike` down to the composite key, so a double tap is a no-op
   * rather than a duplicate row. Saves are private: nothing counts them where
   * the host can see, because "I might want to remember this" is not a headcount.
   */
  toggleSave: protectedProcedure
    .input(z.object({ eventId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const viewerId = ctx.session.user.id;

      const deleted = await ctx.db
        .delete(eventSaves)
        .where(
          and(
            eq(eventSaves.eventId, input.eventId),
            eq(eventSaves.userId, viewerId),
          ),
        )
        .returning({ eventId: eventSaves.eventId });

      if (deleted.length > 0) return { saved: false };

      await ctx.db
        .insert(eventSaves)
        .values({ eventId: input.eventId, userId: viewerId })
        .onConflictDoNothing();

      return { saved: true };
    }),

  /**
   * A host's own numbers, over their whole events — not over the reader's screen.
   *
   * The engagement dialog used to sum whatever rows the feed cursor had loaded,
   * which measured how far the reader had scrolled. These are per-event totals
   * from the tables, for events this person hosts or co-hosts.
   */
  getHostStats: protectedProcedure.query(async ({ ctx }) => {
    const viewerId = ctx.session.user.id;

    const rows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
        region: events.region,
        capacity: events.capacity,
        likeCount:
          sql<number>`(SELECT count(*) FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id})`.mapWith(
            Number,
          ),
        commentCount:
          sql<number>`(SELECT count(*) FROM ${eventComments} WHERE ${eventComments.eventId} = ${events.id})`.mapWith(
            Number,
          ),
        goingCount:
          sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'going')`.mapWith(
            Number,
          ),
        maybeCount:
          sql<number>`(SELECT count(*) FROM ${eventRsvps} WHERE ${eventRsvps.eventId} = ${events.id} AND status = 'maybe')`.mapWith(
            Number,
          ),
        saveCount:
          sql<number>`(SELECT count(*) FROM ${eventSaves} WHERE ${eventSaves.eventId} = ${events.id})`.mapWith(
            Number,
          ),
      })
      .from(events)
      .where(
        or(
          eq(events.createdById, viewerId),
          sql`EXISTS(SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${viewerId})`,
        ),
      )
      .orderBy(desc(events.eventDate))
      .limit(20);

    const totals = rows.reduce(
      (sum, row) => ({
        events: sum.events + 1,
        likes: sum.likes + row.likeCount,
        comments: sum.comments + row.commentCount,
        rsvps: sum.rsvps + row.goingCount + row.maybeCount,
        saves: sum.saves + row.saveCount,
      }),
      { events: 0, likes: 0, comments: 0, rsvps: 0, saves: 0 },
    );

    return { events: rows, totals };
  }),

  /**
   * Retained as a no-op so the client that polls it keeps working during rollout.
   *
   * It never sent a reminder. It logged a line in development and returned
   * success, while a browser `setInterval` called it every five minutes for every
   * user with the publish page open — a per-viewer poll standing in for a clock.
   * Reminders now come from `sendDueEventReminders`, driven by the server-side
   * scheduler tick, which runs whether or not anyone has a tab open.
   */
  sendEventReminders: protectedProcedure
    .input(sendRemindersSchema)
    .mutation(async () => {
      return { success: true, message: "Reminders are delivered by the server scheduler." };
    }),
});