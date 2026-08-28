"use client";

import { Bot, CalendarClock, FolderKanban, Radar, ShieldCheck, Sparkles, StickyNote, Users } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import type { AgentSummary } from "./types";

/**
 * Which icon stands for which agent.
 *
 * Keyed by id rather than carried in the registry: the registry is server code
 * and importing the icon module into it would pull a client library across the
 * `server-only` boundary for the sake of a glyph.
 */
const ICONS: Record<string, typeof Bot> = {
  workspace_concierge: Sparkles,
  task_planner: FolderKanban,
  notes_vault: StickyNote,
  events_publisher: CalendarClock,
  org_admin: Users,
  daily_brief: Bot,
  risk_radar: Radar,
};

export const AUTO_AGENT = "__auto__";

interface Props {
  agents: AgentSummary[];
  /** `AUTO_AGENT`, or an agent id. */
  selected: string;
  onSelect: (id: string) => void;
}

/**
 * Choose who to talk to.
 *
 * Auto is first and is the default. It is not merely "the concierge" — it is
 * A1 routing, which may hand off to up to three specialists in one turn — so it
 * is presented as its own choice rather than as A1's entry in the list, and A1
 * appears below as something you can also address directly.
 *
 * Scheduled agents are listed but not selectable. They have no chat surface, and
 * hiding them would leave a user wondering where the daily brief comes from.
 */
export function AgentPicker({ agents, selected, onSelect }: Props) {
  const t = useTranslations("agents");

  const conversational = agents.filter((a) => a.kind === "conversational");
  const scheduled = agents.filter((a) => a.kind === "scheduled");

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <section>
        <h3 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
          {t("chooseAgent")}
        </h3>

        <button
          type="button"
          onClick={() => onSelect(AUTO_AGENT)}
          aria-pressed={selected === AUTO_AGENT}
          className={`mb-1 flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
            selected === AUTO_AGENT
              ? "bg-accent-primary/10 ring-1 ring-accent-primary/25"
              : "hover:bg-bg-secondary/60"
          }`}
        >
          <Sparkles
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              selected === AUTO_AGENT ? "text-accent-primary" : "text-fg-tertiary"
            }`}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg-primary">
              {t("auto")}
            </span>
            <span className="block text-xs leading-snug text-fg-tertiary">
              {t("autoDescription")}
            </span>
          </span>
        </button>

        {conversational.map((agent) => {
          const Icon = ICONS[agent.id] ?? Bot;
          const isSelected = selected === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              aria-pressed={isSelected}
              className={`mb-1 flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                isSelected
                  ? "bg-accent-primary/10 ring-1 ring-accent-primary/25"
                  : "hover:bg-bg-secondary/60"
              }`}
            >
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  isSelected ? "text-accent-primary" : "text-fg-tertiary"
                }`}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-fg-primary">
                    {agent.name}
                  </span>
                  {agent.writes ? (
                    <ShieldCheck
                      className="h-3 w-3 text-fg-tertiary"
                      aria-label={t("needsApproval")}
                    />
                  ) : null}
                </span>
                <span className="block text-xs leading-snug text-fg-tertiary">
                  {agent.description}
                </span>
              </span>
            </button>
          );
        })}
      </section>

      {scheduled.length > 0 && (
        <section>
          <h3 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
            {t("scheduled")}
          </h3>
          {scheduled.map((agent) => {
            const Icon = ICONS[agent.id] ?? Bot;
            return (
              <div
                key={agent.id}
                className="mb-1 flex items-start gap-2.5 rounded-xl px-2.5 py-2 opacity-70"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-tertiary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg-secondary">
                    {agent.name}
                  </span>
                  <span className="block text-xs leading-snug text-fg-tertiary">
                    {agent.description}
                  </span>
                </span>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
