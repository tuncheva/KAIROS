/**
 * Meeting prep — the brief that arrives before a meeting, not after it.
 *
 * The one scheduled agent that is not tied to an hour of the day. A daily brief
 * is due at 07:00; a meeting prep is due thirty minutes before whatever is next,
 * which means its schedule is derived from the calendar rather than chosen in
 * settings.
 *
 * **It reads the connected calendar, not the product's own events.** That is the
 * whole reason calendar import came first. Users whose meetings live in Google
 * Workspace do not create them twice, so a meeting-prep feature that only knew
 * about events typed into KAIROS would describe a product nobody has.
 *
 * What it does *not* do is send one message per meeting. A day with five
 * back-to-back calls would be five interruptions, each arriving thirty minutes
 * before the last one started — so a run covers the next window in one message
 * and marks what it covered.
 */

import "server-only";

import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { externalEvents, projects, tasks } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { chatCompletion } from "~/server/llm/core/modelClient";
import { toPlainText } from "~/server/llm/core/plainText";
import {
  LOCALE_NAMES,
  type SupportedLocale,
} from "~/server/llm/context/a1ContextBuilder";
import {
  loadVisibleScope,
  visibleProjectsWhere,
} from "~/server/llm/tools/a1/scope";

const log = createLogger("llm.meetingPrep");

/**
 * How far ahead a run looks.
 *
 * Ninety minutes rather than thirty. A sweep runs hourly, so a thirty-minute
 * horizon would miss any meeting whose lead time fell between two ticks — the
 * brief would arrive after the meeting started, or not at all. Ninety covers the
 * gap with margin, and the message says when each meeting actually is.
 */
export const PREP_HORIZON_MINUTES = 90;

/** Meetings named in one message. Beyond this it is an agenda, not a brief. */
const MAX_MEETINGS = 4;

/** Related tasks surfaced per meeting. */
const MAX_TASKS_PER_MEETING = 5;

export interface PrepMeeting {
  id: number;
  title: string;
  startsAt: Date;
  location: string | null;
  attendeeCount: number | null;
  /** Tasks whose titles overlap the meeting's, as context to bring. */
  relatedTasks: Array<{ title: string; status: string; projectTitle: string }>;
}

export interface PrepFacts {
  meetings: PrepMeeting[];
}

/**
 * Words too common to match a meeting against a task on.
 *
 * Without this, a meeting called "Weekly sync" matches every task containing
 * "weekly" and the brief fills with irrelevance. Deliberately short: the goal is
 * to drop connectives, not to build a stopword list.
 */
const NOISE = new Set([
  "the", "and", "for", "with", "meeting", "call", "sync", "weekly", "daily",
  "standup", "review", "catch", "up", "chat", "discussion", "session", "1:1",
  "one", "on",
]);

/** The words in a meeting title worth searching tasks for. */
export function keywordsFrom(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 4 && !NOISE.has(word)),
    ),
  ].slice(0, 4);
}

/**
 * Meetings starting inside the horizon, with whatever context relates to them.
 *
 * `alreadyPrepped` excludes meetings a previous run covered, which is what stops
 * an hourly sweep sending the same brief twice for a meeting two hours out.
 */
export async function collectPrepFacts(
  ctx: TRPCContext,
  userId: string,
  input: { now?: Date; alreadyPrepped?: number[] } = {},
): Promise<PrepFacts> {
  const now = input.now ?? new Date();
  const horizon = new Date(now.getTime() + PREP_HORIZON_MINUTES * 60_000);
  const skip = input.alreadyPrepped ?? [];

  const upcoming = await ctx.db
    .select({
      id: externalEvents.id,
      title: externalEvents.title,
      startsAt: externalEvents.startsAt,
      location: externalEvents.location,
      attendeeCount: externalEvents.attendeeCount,
    })
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.userId, userId),
        gte(externalEvents.startsAt, now),
        lte(externalEvents.startsAt, horizon),
        // A cancelled meeting needs no preparation.
        ne(externalEvents.status, "cancelled"),
        // All-day entries are not meetings — they are holidays, travel, birthdays.
        eq(externalEvents.allDay, false),
        // Declined meetings are not the user's problem.
        or(
          isNull(externalEvents.selfResponse),
          ne(externalEvents.selfResponse, "declined"),
        ),
        skip.length ? sql`${externalEvents.id} NOT IN ${skip}` : sql`true`,
      ),
    )
    .orderBy(asc(externalEvents.startsAt))
    .limit(MAX_MEETINGS);

  if (!upcoming.length) return { meetings: [] };

  // Scope resolved once for the whole run rather than per meeting.
  const scope = await loadVisibleScope(ctx, userId);
  const visible = await ctx.db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(visibleProjectsWhere(scope));

  const titleById = new Map(visible.map((p) => [p.id, p.title]));
  const projectIds = visible.map((p) => p.id);

  const meetings: PrepMeeting[] = [];

  for (const event of upcoming) {
    const keywords = keywordsFrom(event.title);

    const relatedTasks =
      keywords.length && projectIds.length
        ? await ctx.db
            .select({
              title: tasks.title,
              status: tasks.status,
              projectId: tasks.projectId,
            })
            .from(tasks)
            .where(
              and(
                inArray(tasks.projectId, projectIds),
                sql`${tasks.status} <> 'completed'`,
                // Any keyword matching is enough. Requiring all of them finds
                // almost nothing, because a meeting title is rarely a task title.
                or(
                  ...keywords.map(
                    (word) => sql`lower(${tasks.title}) LIKE ${`%${word}%`}`,
                  ),
                ),
              ),
            )
            .limit(MAX_TASKS_PER_MEETING)
        : [];

    meetings.push({
      ...event,
      relatedTasks: relatedTasks.map((task) => ({
        title: task.title,
        status: task.status,
        projectTitle: titleById.get(task.projectId) ?? "",
      })),
    });
  }

  return { meetings };
}

/** Nothing in the window. Silence, not an "all clear". */
export function prepIsEmpty(facts: PrepFacts): boolean {
  return facts.meetings.length === 0;
}

/**
 * The brief without a model call.
 *
 * The floor. Every clause restates a row, so it is always correct — which is what
 * makes it a safe fallback for a message that arrives minutes before a meeting,
 * when being late is the same as being useless.
 */
export function fallbackPrep(facts: PrepFacts): string {
  return facts.meetings
    .map((meeting) => {
      const when = meeting.startsAt.toISOString().slice(11, 16);
      const related = meeting.relatedTasks.length
        ? ` Related: ${meeting.relatedTasks.map((t) => t.title).join(", ")}.`
        : "";
      return `${when} — ${meeting.title}.${related}`;
    })
    .join(" ");
}

/**
 * Write the brief.
 *
 * Explicitly told not to invent an agenda. The model has a meeting title, a time,
 * an attendee count and some possibly-related tasks; anything resembling "you
 * should discuss X" would be fabricated, and a confident fabrication arriving
 * five minutes before a meeting is the worst possible time to be wrong.
 */
export async function writePrep(input: {
  facts: PrepFacts;
  userName: string | null;
  locale: SupportedLocale;
}): Promise<string> {
  const { facts, locale } = input;

  try {
    const res = await chatCompletion({
      temperature: 0.3,
      maxTokens: 900,
      purpose: "a6.meetingPrep",
      messages: [
        {
          role: "system",
          content: `You are the KAIROS meeting prep — a short message sent shortly before a meeting starts.

Write 1-3 short sentences for ${input.userName ?? "the user"}.

Rules:
- Use ONLY the facts given. Never invent an agenda, a topic, or who will be there.
- Lead with the meeting and when it starts.
- If related tasks are listed, mention at most two, as context they may want to hand.
- If nothing relates to the meeting, say only what the meeting is. Do not pad.
- No headings, no bullets, no markdown — this is read in a notification, on a phone, in a hurry.
- Write entirely in ${LOCALE_NAMES[locale]}.

Reply with the message text only.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            meetings: facts.meetings.map((meeting) => ({
              title: meeting.title,
              startsAt: meeting.startsAt.toISOString(),
              location: meeting.location,
              attendees: meeting.attendeeCount,
              relatedTasks: meeting.relatedTasks,
            })),
          }),
        },
      ],
    });

    const text = toPlainText(res.content);
    return text.length > 0 ? text : fallbackPrep(facts);
  } catch (err) {
    log.warn("meeting prep generation failed, sending the plain version", { err });
    return fallbackPrep(facts);
  }
}
