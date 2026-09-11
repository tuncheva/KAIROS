import { loadUserMemory, type MemoryFact } from "~/server/llm/memory";
import { resolveUserLocale, type SupportedLocale } from "~/server/llm/locale";
import type { TRPCContext } from "~/server/api/trpc";
import { events, eventComments, eventLikes, users, calendarConnections } from "~/server/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { hasWriteScope } from "~/server/calendar/google";

export interface A4ContextEvent {
  id: number;
  title: string;
  description: string;
  eventDate: string;
  region: string;
  imageUrl: string | null;
  enableRsvp: boolean;
  likeCount: number;
  commentCount: number;
  isOwner: boolean;
  authorName: string | null;
  createdAt: string;
}

export interface A4ContextPack {
  userId: string;
  events: A4ContextEvent[];
  /**
   * The user's saved interface language — the fallback reply language when the
   * message itself gives nothing to detect from.
   */
  locale: SupportedLocale;
  /** Global facts plus any the user set for the Events Publisher specifically. */
  memory: MemoryFact[];
  calendar: {
    connected: boolean;
    /** True only when the stored token has the events write scope. */
    writeEnabled: boolean;
  } | null;
}

/**
 * Build context pack for the A4 Events Publisher agent.
 * Returns the current user's perspective on the public event feed
 * (up to 30 most recent events) so the LLM can make informed decisions.
 */
export async function buildA4Context(input: {
  ctx: TRPCContext;
}): Promise<A4ContextPack> {
  const userId = input.ctx.session?.user?.id;
  if (!userId) throw new Error("UNAUTHORIZED");

  const rows = await input.ctx.db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      eventDate: events.eventDate,
      region: events.region,
      imageUrl: events.imageUrl,
      enableRsvp: events.enableRsvp,
      createdById: events.createdById,
      createdAt: events.createdAt,
      authorName: users.name,
      likeCount: sql<number>`(SELECT count(*) FROM ${eventLikes} WHERE ${eventLikes.eventId} = ${events.id})`.mapWith(Number),
      commentCount: sql<number>`(SELECT count(*) FROM ${eventComments} WHERE ${eventComments.eventId} = ${events.id})`.mapWith(Number),
    })
    .from(events)
    .leftJoin(users, eq(events.createdById, users.id))
    .orderBy(desc(events.createdAt))
    .limit(30);

  const [[calConn], [memory, locale]] = await Promise.all([
    input.ctx.db
      .select({ scope: calendarConnections.scope })
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, userId))
      .limit(1),
    Promise.all([
      loadUserMemory(input.ctx, userId, "events_publisher"),
      resolveUserLocale(input.ctx, userId),
    ]),
  ]);

  const calendar = calConn
    ? { connected: true, writeEnabled: hasWriteScope(calConn.scope) }
    : null;

  return {
    userId,
    locale,
    memory,
    calendar,
    events: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      eventDate: r.eventDate.toISOString(),
      region: r.region,
      imageUrl: r.imageUrl,
      enableRsvp: r.enableRsvp,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
      isOwner: r.createdById === userId,
      authorName: r.authorName,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
