/**
 * B-1 — A6, the Briefing Agent.
 *
 * The one agent that speaks first. Read-only, so it has no draft/confirm/apply
 * lifecycle at all: there is nothing to approve, because there is nothing to
 * undo.
 *
 * The division of labour with `riskRadar.ts` is the point. The radar counts —
 * deterministically, in Postgres — and A6 writes. Handing the model four hundred
 * task rows and asking for a summary would be slower, costlier, and wrong about
 * the numbers; handing it eight already-computed findings and asking for four
 * sentences is exactly the job it is good at. It also degrades well: if the model
 * is unavailable or the user's system budget is spent, the brief still goes out,
 * assembled from the findings without a model call.
 *
 * Written in the user's saved language, because a brief that arrives unprompted
 * in the wrong language is worse than no brief.
 */

import "server-only";
import { toPlainText } from "~/server/llm/core/plainText";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { events, projects, tasks } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { chatCompletion } from "~/server/llm/core/modelClient";
import { LOCALE_NAMES, type SupportedLocale } from "~/server/llm/context/a1ContextBuilder";
import {
  loadVisibleScope,
  visibleProjectsWhere,
} from "~/server/llm/tools/a1/scope";

import type { Finding } from "./riskRadar";

const log = createLogger("llm.dailyBrief");

export interface BriefFacts {
  dueToday: Array<{ id: number; title: string; projectTitle: string }>;
  overdue: number;
  completedYesterday: number;
  eventsToday: Array<{ id: number; title: string }>;
  openFindings: number;
}

/**
 * Gather the day's numbers.
 *
 * All computed in SQL against the caller's visible scope, so the brief can never
 * mention a project the user cannot open.
 */
export async function collectBriefFacts(
  ctx: TRPCContext,
  userId: string,
  findings: Finding[],
): Promise<BriefFacts> {
  const scope = await loadVisibleScope(ctx, userId);
  const visible = await ctx.db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(visibleProjectsWhere(scope));

  const titleById = new Map(visible.map((p) => [p.id, p.title]));
  const projectIds = visible.map((p) => p.id);

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const yesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);

  if (!projectIds.length) {
    return {
      dueToday: [],
      overdue: 0,
      completedYesterday: 0,
      eventsToday: [],
      openFindings: findings.length,
    };
  }

  const [dueTodayRows, overdueRow, completedRow, eventRows] = await Promise.all([
    ctx.db
      .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          eq(tasks.assignedToId, userId),
          gte(tasks.dueDate, startOfDay),
          lte(tasks.dueDate, endOfDay),
        ),
      )
      .limit(10),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          eq(tasks.assignedToId, userId),
          lte(tasks.dueDate, startOfDay),
          sql`${tasks.status} <> 'completed'`,
        ),
      )
      .then((r) => r[0]),

    ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          gte(tasks.completedAt, yesterday),
          lte(tasks.completedAt, startOfDay),
        ),
      )
      .then((r) => r[0]),

    ctx.db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(and(gte(events.eventDate, startOfDay), lte(events.eventDate, endOfDay)))
      .limit(5),
  ]);

  return {
    dueToday: dueTodayRows.map((r) => ({
      id: r.id,
      title: r.title,
      projectTitle: titleById.get(r.projectId) ?? "",
    })),
    overdue: overdueRow?.count ?? 0,
    completedYesterday: completedRow?.count ?? 0,
    eventsToday: eventRows,
    openFindings: findings.length,
  };
}

/** True when there is genuinely nothing worth interrupting someone for. */
export function briefIsEmpty(facts: BriefFacts, findings: Finding[]): boolean {
  return (
    facts.dueToday.length === 0 &&
    facts.overdue === 0 &&
    facts.eventsToday.length === 0 &&
    findings.length === 0
  );
}

/**
 * The brief without a model call.
 *
 * Not a degraded mode so much as the floor: it is always correct, because it only
 * restates numbers that were computed in SQL. A6's contribution on top is tone
 * and prioritisation, not facts.
 */
export function fallbackBrief(facts: BriefFacts, findings: Finding[]): string {
  const parts: string[] = [];

  if (facts.dueToday.length) {
    parts.push(
      `${String(facts.dueToday.length)} task(s) due today: ${facts.dueToday
        .slice(0, 3)
        .map((t) => t.title)
        .join(", ")}.`,
    );
  }
  if (facts.overdue) parts.push(`${String(facts.overdue)} overdue.`);
  if (facts.eventsToday.length) {
    parts.push(
      `Events today: ${facts.eventsToday.map((e) => e.title).join(", ")}.`,
    );
  }
  for (const finding of findings.slice(0, 3)) parts.push(finding.title + ".");

  return parts.join(" ") || "Nothing needs your attention today.";
}

/**
 * Write the brief.
 *
 * Falls back to {@link fallbackBrief} on any model failure — a brief that goes
 * out plainly beats a brief that does not go out.
 */
export async function writeBrief(input: {
  facts: BriefFacts;
  findings: Finding[];
  userName: string | null;
  locale: SupportedLocale;
}): Promise<string> {
  const { facts, findings, locale } = input;

  try {
    const res = await chatCompletion({
      // The strong tier: this is the one piece of writing the user reads before
      // they have asked anything, so it is the wrong place to save a fraction of
      // a cent.
      temperature: 0.4,
      maxTokens: 2_000,
      purpose: "a6.dailyBrief",
      messages: [
        {
          role: "system",
          content: `You are the KAIROS Daily Brief — the assistant's one unprompted message of the day.

Write 2-4 short sentences for ${input.userName ?? "the user"} about their working day.

Rules:
- Use ONLY the facts given. Never invent a number, a name or a deadline.
- Lead with what is most urgent or most surprising, not with a greeting.
- Say what to do about it, briefly, where it is obvious.
- No headings, no bullet points, no markdown — this is read inside a notification.
- Warm and direct. Never apologetic, never breathless.
- If the day looks genuinely quiet, say so in one sentence and stop.
- Write entirely in ${LOCALE_NAMES[locale]}.

Reply with the brief text only.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            dueToday: facts.dueToday,
            overdueCount: facts.overdue,
            completedYesterday: facts.completedYesterday,
            eventsToday: facts.eventsToday,
            risks: findings.map((f) => ({
              severity: f.severity,
              title: f.title,
              detail: f.detail,
            })),
          }),
        },
      ],
    });

    const text = toPlainText(res.content);
    return text.length > 0 ? text : fallbackBrief(facts, findings);
  } catch (err) {
    log.warn("brief generation failed, sending the plain version", { err });
    return fallbackBrief(facts, findings);
  }
}
