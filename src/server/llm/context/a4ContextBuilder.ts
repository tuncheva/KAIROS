import { loadUserMemory, type MemoryFact } from "~/server/llm/memory";
import { resolveUserLocale, type SupportedLocale } from "~/server/llm/locale";
import type { TRPCContext } from "~/server/api/trpc";
import { events, eventComments, eventLikes, users } from "~/server/db/schema";
import { eq, desc, sql } from "drizzle-orm";

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

  const [memory, locale] = await Promise.all([
    loadUserMemory(input.ctx, userId, "events_publisher"),
    resolveUserLocale(input.ctx, userId),
  ]);

  return {
    userId,
    locale,
    memory,
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
