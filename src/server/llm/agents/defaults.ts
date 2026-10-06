/**
 * Workspace defaults the specialists fill into a plan.
 *
 * Applied when the plan is drafted, not when it is applied: the user reviews
 * the draft, so a default they would not have chosen is visible — and editable —
 * before anything is written. Every function here only fills a gap; a value the
 * model set because the request asked for it is never overridden.
 *
 * Pure on purpose, so the rules are testable without a database.
 */

import {
  agentSetting,
  projectNameFitsPattern,
  type ResolvedAgentSettings,
} from "~/lib/agentSettings";

type Settings = Partial<ResolvedAgentSettings> | undefined;

/** Noon UTC `days` after `now` — a due date that reads as the same day in every time zone. */
function dueInDays(now: Date, days: number): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 12),
  ).toISOString();
}

/** Odysseus: the workspace's task defaults for whatever the model left unset. */
export function applyTaskDefaults<
  T extends {
    priority?: "low" | "medium" | "high" | "urgent";
    dueDate?: string | null;
    assignedToId?: string;
  },
>(
  create: T,
  settings: Settings,
  context: { requesterId: string; now: Date },
): T & { priority: "low" | "medium" | "high" | "urgent" } {
  const due = agentSetting(settings, "task_planner.dueInDays");
  const assignee = agentSetting(settings, "task_planner.assignee");
  return {
    ...create,
    priority: create.priority ?? agentSetting(settings, "task_planner.priority"),
    dueDate: create.dueDate ?? (due === "none" ? create.dueDate : dueInDays(context.now, due)),
    assignedToId:
      create.assignedToId ?? (assignee === "requester" ? context.requesterId : undefined),
  };
}

/** Iris: length, RSVP and reminders for a new event that did not specify them. */
export function applyEventDefaults<
  T extends {
    eventDate: string;
    endsAt?: string;
    enableRsvp?: boolean;
    sendReminders?: boolean;
  },
>(
  create: T,
  settings: Settings,
): T & { endsAt: string | undefined; enableRsvp: boolean; sendReminders: boolean } {
  const length = agentSetting(settings, "events_publisher.lengthMinutes");
  const start = new Date(create.eventDate);
  const endsAt =
    create.endsAt ??
    (length === "none" || Number.isNaN(start.getTime())
      ? undefined
      : new Date(start.getTime() + length * 60_000).toISOString());
  return {
    ...create,
    endsAt,
    enableRsvp: create.enableRsvp ?? agentSetting(settings, "events_publisher.enableRsvp"),
    sendReminders: create.sendReminders ?? agentSetting(settings, "events_publisher.sendReminders"),
  };
}

/**
 * Daedalus: the new project names that do not follow the workspace pattern.
 *
 * A name is never rewritten — the user may have a reason — so a mismatch
 * becomes a warning on the draft rather than a silent change.
 */
export function namesOffPattern(titles: readonly string[], settings: Settings): string[] {
  const pattern = agentSetting(settings, "project_manager.namingPattern");
  return titles.filter((title) => !projectNameFitsPattern(title, pattern));
}
