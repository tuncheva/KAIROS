/**
 * The weekly retrospective — the second thing A6 says without being asked.
 *
 * Same shape as `dailyBrief.ts` and deliberately so: count in Postgres, write in
 * the model, degrade to the counts alone when the model is unavailable or the
 * budget is spent. What differs is the question being answered. The brief is
 * about the next few hours and is therefore a list of things to do; the
 * retrospective is about the last seven days and is a description of how the
 * week actually went — closed against created, what carried over, what has not
 * moved at all.
 *
 * That difference drives the one design decision worth stating: **a retrospective
 * with nothing but good news is still worth sending.** The brief stays quiet when
 * the day is empty, because an "all clear" every morning is how people learn to
 * stop reading. A retrospective arrives once a week and its value is partly the
 * ritual — "you closed eleven things" is a legitimate message, where "nothing is
 * due today" is not. {@link retroIsEmpty} is correspondingly much harder to
 * satisfy than `briefIsEmpty`.
 *
 * Written in the user's saved language, like everything else that arrives
 * unprompted.
 */

import "server-only";
import { toPlainText } from "~/server/llm/core/plainText";

import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { aiFindings, events, projects, tasks } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { chatCompletion } from "~/server/llm/core/modelClient";
import {
  LOCALE_NAMES,
  type SupportedLocale,
} from "~/server/llm/context/a1ContextBuilder";
import {
  loadVisibleScope,
  visibleProjectsWhere,
} from "~/server/llm/tools/a1/scope";

const log = createLogger("llm.weeklyRetro");

/** How long the retrospective looks back. */
const WINDOW_DAYS = 7;

/**
 * How long a task must sit untouched before it counts as stalled.
 *
 * Longer than the window on purpose. A task that has not moved in eight days has
 * survived one whole retrospective already, which is what makes it worth naming
 * in the second one.
 */
const STALLED_DAYS = 14;

/** Titles carried into the prompt per category — enough to be concrete, not a dump. */
const SAMPLE_LIMIT = 5;

export interface RetroFacts {
  completed: number;
  completedSample: Array<{ id: number; title: string; projectTitle: string }>;
  created: number;
  /** Open tasks that existed before this window opened. */
  carriedOver: number;
  stalled: Array<{ id: number; title: string; projectTitle: string; days: number }>;
  eventsHeld: number;
  findingsRaised: number;
  findingsDismissed: number;
  overdueNow: number;
}

/**
 * Gather the week's numbers.
 *
 * The window is the seven days ending now, not seven calendar days ending at a
 * local midnight. A retrospective fired at 17:00 on Friday describing the
 * previous 168 hours is what a reader expects, and defining it this way needs no
 * local-midnight arithmetic — which is the one part of zone handling that has a
 * genuine edge case, in zones whose DST transition happens at midnight.
 *
 * Everything is computed in SQL against the caller's visible scope, so the
 * retrospective can never mention a project the user cannot open.
 */
export async function collectRetroFacts(
  ctx: TRPCContext,
  userId: string,
  now = new Date(),
): Promise<RetroFacts> {
  const scope = await loadVisibleScope(ctx, userId);
  const visible = await ctx.db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(visibleProjectsWhere(scope));

  const titleById = new Map(visible.map((p) => [p.id, p.title]));
  const projectIds = visible.map((p) => p.id);

  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const stalledBefore = new Date(now.getTime() - STALLED_DAYS * 86_400_000);

  const empty: RetroFacts = {
    completed: 0,
    completedSample: [],
    created: 0,
    carriedOver: 0,
    stalled: [],
    eventsHeld: 0,
    findingsRaised: 0,
    findingsDismissed: 0,
    overdueNow: 0,
  };

  if (!projectIds.length) return empty;

  const inScope = inArray(tasks.projectId, projectIds);
  const stillOpen = sql`${tasks.status} <> 'completed'`;

  const [
    completedRow,
    completedSampleRows,
    createdRow,
    carriedOverRow,
    stalledRows,
    eventsRow,
    findingsRaisedRow,
    findingsDismissedRow,
    overdueRow,
  ] = await Promise.all([
    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(and(inScope, gte(tasks.completedAt, windowStart)))
      .then((r) => r[0]),

    ctx.db
      .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId })
      .from(tasks)
      .where(and(inScope, gte(tasks.completedAt, windowStart)))
      .orderBy(desc(tasks.completedAt))
      .limit(SAMPLE_LIMIT),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(and(inScope, gte(tasks.createdAt, windowStart)))
      .then((r) => r[0]),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(and(inScope, stillOpen, lt(tasks.createdAt, windowStart)))
      .then((r) => r[0]),

    // "Untouched" has to consider both columns: `lastEditedAt` is null for a task
    // nobody has edited since creation, and treating that as "never touched" via
    // a null-unsafe comparison would silently drop every such task from the list —
    // which is exactly the population being looked for.
    ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        projectId: tasks.projectId,
        touchedAt: sql<Date>`COALESCE(${tasks.lastEditedAt}, ${tasks.createdAt})`,
      })
      .from(tasks)
      .where(
        and(
          inScope,
          stillOpen,
          or(
            and(isNull(tasks.lastEditedAt), lt(tasks.createdAt, stalledBefore)),
            lt(tasks.lastEditedAt, stalledBefore),
          ),
        ),
      )
      .limit(SAMPLE_LIMIT),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(events)
      .where(and(gte(events.eventDate, windowStart), lte(events.eventDate, now)))
      .then((r) => r[0]),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(aiFindings)
      .where(
        and(eq(aiFindings.userId, userId), gte(aiFindings.createdAt, windowStart)),
      )
      .then((r) => r[0]),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(aiFindings)
      .where(
        and(
          eq(aiFindings.userId, userId),
          gte(aiFindings.dismissedAt, windowStart),
        ),
      )
      .then((r) => r[0]),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(and(inScope, stillOpen, lt(tasks.dueDate, now)))
      .then((r) => r[0]),
  ]);

  const withProject = (r: { id: number; title: string; projectId: number }) => ({
    id: r.id,
    title: r.title,
    projectTitle: titleById.get(r.projectId) ?? "",
  });

  return {
    completed: completedRow?.count ?? 0,
    completedSample: completedSampleRows.map(withProject),
    created: createdRow?.count ?? 0,
    carriedOver: carriedOverRow?.count ?? 0,
    stalled: stalledRows.map((r) => ({
      ...withProject(r),
      days: Math.floor(
        (now.getTime() - new Date(r.touchedAt).getTime()) / 86_400_000,
      ),
    })),
    eventsHeld: eventsRow?.count ?? 0,
    findingsRaised: findingsRaisedRow?.count ?? 0,
    findingsDismissed: findingsDismissedRow?.count ?? 0,
    overdueNow: overdueRow?.count ?? 0,
  };
}

/**
 * True when the week contained no activity at all.
 *
 * A much narrower test than `briefIsEmpty`. The brief suppresses itself whenever
 * the day holds nothing *actionable*, because it competes with the user's morning
 * every single day. A retrospective arrives once a week, and "eleven things
 * closed, nothing stalled" is a message worth having — so this only suppresses a
 * week in which genuinely nothing happened and nothing is outstanding, which for
 * most users means they were away.
 */
export function retroIsEmpty(facts: RetroFacts): boolean {
  return (
    facts.completed === 0 &&
    facts.created === 0 &&
    facts.carriedOver === 0 &&
    facts.stalled.length === 0 &&
    facts.eventsHeld === 0 &&
    facts.overdueNow === 0
  );
}

/**
 * The retrospective without a model call.
 *
 * The floor, not a degraded mode: every sentence restates a number computed in
 * SQL. What the model adds is ordering and tone, never facts.
 */
export function fallbackRetro(facts: RetroFacts): string {
  const parts: string[] = [];

  parts.push(
    `Last 7 days: ${String(facts.completed)} task(s) completed, ${String(facts.created)} created.`,
  );

  if (facts.carriedOver) {
    parts.push(`${String(facts.carriedOver)} open task(s) carried over.`);
  }
  if (facts.overdueNow) parts.push(`${String(facts.overdueNow)} now overdue.`);
  if (facts.stalled.length) {
    parts.push(
      `Not moved in ${String(STALLED_DAYS)}+ days: ${facts.stalled
        .map((t) => t.title)
        .join(", ")}.`,
    );
  }
  if (facts.eventsHeld) parts.push(`${String(facts.eventsHeld)} event(s) held.`);

  return parts.join(" ");
}

/**
 * Write the retrospective.
 *
 * Falls back to {@link fallbackRetro} on any model failure, for the same reason
 * the brief does: one that goes out plainly beats one that does not go out.
 */
export async function writeRetro(input: {
  facts: RetroFacts;
  userName: string | null;
  locale: SupportedLocale;
}): Promise<string> {
  const { facts, locale } = input;

  try {
    const res = await chatCompletion({
      temperature: 0.4,
      maxTokens: 2_000,
      purpose: "a6.weeklyRetro",
      messages: [
        {
          role: "system",
          content: `You are the KAIROS weekly retrospective — one unprompted message at the end of the working week.

Write 3-5 short sentences for ${input.userName ?? "the user"} about the week just finished.

Rules:
- Use ONLY the facts given. Never invent a number, a name or a deadline.
- Open with the shape of the week — what moved — before what did not.
- Completed versus created is the most informative comparison; use it when both are non-zero.
- Name at most two stalled items, and only if they are genuinely stalled.
- This is a review, not a task list. Do not tell the user what to do next.
- No headings, no bullet points, no markdown — this is read inside a notification.
- Warm and direct. Do not congratulate effusively and do not scold.
- Write entirely in ${LOCALE_NAMES[locale]}.

Reply with the retrospective text only.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            windowDays: WINDOW_DAYS,
            completed: facts.completed,
            completedExamples: facts.completedSample,
            created: facts.created,
            carriedOver: facts.carriedOver,
            overdueNow: facts.overdueNow,
            stalled: facts.stalled,
            eventsHeld: facts.eventsHeld,
            risksRaised: facts.findingsRaised,
            risksDismissed: facts.findingsDismissed,
          }),
        },
      ],
    });

    const text = toPlainText(res.content);
    return text.length > 0 ? text : fallbackRetro(facts);
  } catch (err) {
    log.warn("retro generation failed, sending the plain version", { err });
    return fallbackRetro(facts);
  }
}
