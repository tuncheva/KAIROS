"use client";

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "~/lib/utils";
import {
  SUGGESTION_DOT,
  SUGGESTION_TEXT,
  buildBoard,
  countLogged,
  daysBetween,
  fromYmd,
  displayName,
  formatTook,
  initialsOf,
  projectTone,
  type LeaderboardPerson,
  type LogGroup,
  type RecordSummary,
  type Suggestion,
  type WorkloadEntry,
} from "./progressModel";

/** Where a project opens. Same target the dashboard and /projects use. */
export const projectHref = (id: number) => `/create?action=new_project&projectId=${id}`;

/** The redesign names the priority in the "pick this up next" line. */
const PRIORITY_LABEL_KEYS: Record<string, string> = {
  urgent: "priorityUrgent",
  high: "priorityHigh",
  medium: "priorityMedium",
  low: "priorityLow",
};

const MICRO_LABEL = "text-[10px] uppercase tracking-[0.14em] text-fg-tertiary";
const SECTION_TITLE = "text-[15px] font-semibold tracking-[-0.01em] text-fg-primary";
const PANEL = "rounded-xl border border-border-light bg-bg-elevated";

/* ------------------------------------------------------------------ */
/*  Stats                                                            */
/* ------------------------------------------------------------------ */

export type Stat = {
  key: string;
  label: string;
  value: string;
  delta: string;
  /** Tailwind text colour for the value; the default is plain foreground. */
  valueClass?: string;
  deltaClass?: string;
};

/** Finished / per day / streak / best day — the four numbers on the record. */
export function useRecordStats(summary: RecordSummary, locale: string): Stat[] {
  const t = useTranslations("progress.record");

  const bestDay = summary.bestDay
    ? summary.bestDay.toLocaleDateString(locale === "bg" ? "bg-BG" : locale, {
        day: "numeric",
        month: "short",
      })
    : "—";

  return [
    {
      key: "finished",
      label: t("statFinished"),
      value: String(summary.finished),
      delta: t("statInDays", { count: summary.days }),
    },
    {
      key: "perDay",
      label: t("statPerDay"),
      value: summary.perDay,
      delta: t("statAvg"),
    },
    {
      key: "streak",
      label: t("statStreak"),
      value: t("streakDays", { count: summary.streak }),
      valueClass: summary.streak >= 3 ? "text-info" : undefined,
      delta: summary.streak >= 3 ? t("streakRunning") : t("streakFragile"),
      deltaClass: summary.streak >= 3 ? "text-info" : "text-warning",
    },
    {
      key: "best",
      label: t("statBestDay"),
      value: String(summary.bestCount),
      delta: bestDay,
    },
  ];
}

/** The wide layout reads the numbers along one baseline. */
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-9 gap-y-3">
      {stats.map((stat) => (
        <div key={stat.key} className="flex items-baseline gap-2.5">
          <span
            className={cn(
              "text-[21px] font-semibold tracking-[-0.02em] tabular-nums",
              stat.valueClass ?? "text-fg-primary",
            )}
          >
            {stat.value}
          </span>
          <span className={MICRO_LABEL}>{stat.label}</span>
          <span className={cn("text-[11px] tabular-nums", stat.deltaClass ?? "text-fg-tertiary")}>
            {stat.delta}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The profile column stacks them instead, one hairline row each. */
export function StatColumn({ stats }: { stats: Stat[] }) {
  return (
    <div className="flex flex-col">
      {stats.map((stat) => (
        <div
          key={stat.key}
          className="flex items-baseline justify-between gap-3 border-b border-border-light py-3"
        >
          <span className={MICRO_LABEL}>{stat.label}</span>
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "text-[22px] font-semibold tracking-[-0.02em] tabular-nums",
                stat.valueClass ?? "text-fg-primary",
              )}
            >
              {stat.value}
            </span>
            <span className={cn("text-[11px] tabular-nums", stat.deltaClass ?? "text-fg-tertiary")}>
              {stat.delta}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Suggestions                                                      */
/* ------------------------------------------------------------------ */

type SuggestionCopy = { title: string; body: string; cta: string | null; href: string | null };

function useSuggestionCopy() {
  const t = useTranslations("progress.record");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : locale;

  return (suggestion: Suggestion): SuggestionCopy => {
    if (suggestion.id === "pace") {
      return {
        title:
          suggestion.direction === "down"
            ? t("paceDown", { percent: suggestion.percent })
            : t("paceUp", { percent: suggestion.percent }),
        body: t("paceBody", {
          thisWeek: suggestion.thisWeek,
          previousWeek: suggestion.previousWeek,
        }),
        cta: null,
        href: null,
      };
    }

    if (suggestion.id === "stale") {
      return {
        title: t("staleTitle", {
          project: suggestion.projectTitle,
          days: suggestion.quietDays,
        }),
        body: t("staleBody", { count: suggestion.open }),
        cta: t("staleCta"),
        href: projectHref(suggestion.projectId),
      };
    }

    // "Urgent, due 4 Sep, 2 tasks waiting behind it" — assembled from the
    // parts that actually apply, since most tasks have no due date.
    const parts = [t(PRIORITY_LABEL_KEYS[suggestion.priority] ?? "priorityMedium")];
    if (suggestion.dueDate) {
      parts.push(
        t("nextDue", {
          date: suggestion.dueDate.toLocaleDateString(dateLocale, {
            day: "numeric",
            month: "short",
          }),
        }),
      );
    }
    if (suggestion.waitingBehind > 0) {
      parts.push(t("nextWaiting", { count: suggestion.waitingBehind }));
    }

    return {
      title: t("nextTitle", { task: suggestion.title }),
      body: parts.join(", "),
      cta: t("nextCta"),
      href: projectHref(suggestion.projectId),
    };
  };
}

type SuggestionListProps = {
  suggestions: Suggestion[];
  onDismiss: (id: string) => void;
  /** `rows` is the wide hairline list, `stacked` the narrow profile column. */
  variant: "rows" | "stacked";
};

export function SuggestionList({ suggestions, onDismiss, variant }: SuggestionListProps) {
  const t = useTranslations("progress.record");
  const copyFor = useSuggestionCopy();

  return (
    <div className="flex flex-col gap-2.5">
      <span className={MICRO_LABEL}>{t("suggestions")}</span>

      {suggestions.length === 0 && (
        <p className="border-t border-border-light py-3 text-[13px] text-fg-tertiary">
          {t("suggestionsEmpty")}
        </p>
      )}

      <div className="flex flex-col">
        {suggestions.map((suggestion) => {
          const copy = copyFor(suggestion);
          const stacked = variant === "stacked";

          return (
            <div
              key={suggestion.id}
              className={cn(
                "flex gap-2.5 border-t border-border-light transition-colors hover:bg-fg-primary/[0.02]",
                stacked ? "items-start py-2.5" : "items-center py-2.5",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full opacity-75",
                  SUGGESTION_DOT[suggestion.tone],
                  stacked && "mt-2",
                )}
              />

              <div
                className={cn(
                  "min-w-0 flex-1",
                  stacked ? "flex flex-col gap-1" : "flex flex-wrap items-baseline gap-x-1.5",
                )}
              >
                <span className="text-[13px] leading-relaxed text-fg-secondary">{copy.title}</span>
                <span className="text-[13px] leading-relaxed text-fg-tertiary">
                  {stacked ? copy.body : `— ${copy.body}`}
                </span>

                {stacked && copy.cta && copy.href && (
                  <Link
                    href={copy.href}
                    className={cn(
                      "mt-0.5 flex items-center gap-1.5 self-start text-xs font-medium opacity-85 transition-opacity hover:opacity-100",
                      SUGGESTION_TEXT[suggestion.tone],
                    )}
                  >
                    {copy.cta}
                    <ArrowRight size={12} />
                  </Link>
                )}
              </div>

              {!stacked && copy.cta && copy.href && (
                <Link
                  href={copy.href}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 text-xs font-medium opacity-85 transition-opacity hover:opacity-100",
                    SUGGESTION_TEXT[suggestion.tone],
                  )}
                >
                  {copy.cta}
                  <ArrowRight size={12} />
                </Link>
              )}

              <button
                type="button"
                onClick={() => onDismiss(suggestion.id)}
                aria-label={t("dismiss")}
                title={t("dismiss")}
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-fg-quaternary opacity-60 transition-opacity hover:bg-bg-secondary hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The finished log                                                 */
/* ------------------------------------------------------------------ */

type LogProps = {
  groups: LogGroup[];
  selectedYmd: string | null;
  onClearDay: () => void;
  variant: "rows" | "boxed";
  today: Date;
};

export function FinishedLog({ groups, selectedYmd, onClearDay, variant, today }: LogProps) {
  const t = useTranslations("progress.record");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : locale;

  const dayLabel = (date: Date) => {
    const label = date.toLocaleDateString(dateLocale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    return daysBetween(date, today) === 0 ? t("todayPrefix", { day: label }) : label;
  };

  const took = (tookDays: number) => {
    const { value, unit } = formatTook(tookDays);
    return unit === "d" ? t("tookDays", { value }) : t("tookHours", { value });
  };

  const selectedDate = selectedYmd ? fromYmd(selectedYmd) : null;
  const total = countLogged(groups);
  const boxed = variant === "boxed";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className={SECTION_TITLE}>
          {selectedDate ? t("logOnDay", { day: dayLabel(selectedDate) }) : t("logRecent")}
        </h2>
        <span className="text-[11px] tabular-nums text-fg-tertiary">
          {t("logCount", { count: total })}
        </span>
        <span className="flex-1" />
        {selectedYmd && (
          <button
            type="button"
            onClick={onClearDay}
            className="h-7 rounded-md border border-border-medium px-2.5 text-[11px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary"
          >
            {t("logShowRecent")}
          </button>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col",
          boxed ? `${PANEL} overflow-hidden` : "border-t border-border-light",
        )}
      >
        {groups.length === 0 && (
          <p
            className={cn(
              "text-[13px] text-fg-tertiary",
              boxed ? "px-4 py-6" : "py-6",
            )}
          >
            {selectedYmd ? t("logEmptyDay") : t("logEmpty")}
          </p>
        )}

        {groups.map((group) => (
          <div key={group.ymd} className="flex flex-col">
            <div
              className={cn(
                MICRO_LABEL,
                boxed
                  ? "border-b border-border-light bg-bg-secondary px-4 py-2.5"
                  : "pt-3 pb-2",
              )}
            >
              {dayLabel(group.date)}
            </div>

            {group.items.map((item) => {
              const tone = projectTone(item.projectId);

              if (boxed) {
                return (
                  <Link
                    key={item.id}
                    href={projectHref(item.projectId)}
                    className="flex items-center gap-3 border-b border-border-light px-4 py-3 transition-colors last:border-b-0 hover:bg-bg-secondary/60"
                  >
                    <span className={cn("h-6 w-[3px] shrink-0 rounded-sm", tone.bar)} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-medium text-fg-primary">
                        {item.title}
                      </span>
                      <span className="truncate text-[10px] tabular-nums text-fg-tertiary">
                        {item.projectTitle} · {took(item.tookDays)}
                      </span>
                    </span>
                  </Link>
                );
              }

              return (
                <Link
                  key={item.id}
                  href={projectHref(item.projectId)}
                  className="grid grid-cols-[minmax(0,1fr)_130px_58px] items-center gap-3.5 border-b border-border-light py-2.5 transition-colors hover:bg-fg-primary/[0.025]"
                >
                  <span className="truncate text-[13px] font-medium text-fg-primary">
                    {item.title}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", tone.dot)} />
                    <span className="truncate text-xs text-fg-secondary">{item.projectTitle}</span>
                  </span>
                  <span className="text-right text-[11px] tabular-nums text-fg-tertiary">
                    {took(item.tookDays)}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Remaining workload                                               */
/* ------------------------------------------------------------------ */

type WorkloadProps = {
  workload: WorkloadEntry[];
  today: Date;
  variant: "panel" | "bare";
};

export function WorkloadList({ workload, today, variant }: WorkloadProps) {
  const t = useTranslations("progress.record");
  const maxOpen = workload.reduce((max, entry) => Math.max(max, entry.open), 1);
  const panel = variant === "panel";

  const quietLabel = (lastTouchedAt: WorkloadEntry["lastTouchedAt"]) => {
    if (!lastTouchedAt) return "";
    const quiet = daysBetween(new Date(lastTouchedAt), today);
    return quiet <= 0 ? t("workloadToday") : t("workloadQuiet", { count: quiet });
  };

  return (
    <div className={cn("flex flex-col gap-3.5", panel && `${PANEL} px-5 py-4`)}>
      {workload.length === 0 && (
        <p className="text-[13px] text-fg-tertiary">{t("workloadEmpty")}</p>
      )}

      {workload.map((entry) => {
        const tone = projectTone(entry.projectId);
        return (
          <div key={entry.projectId} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2.5">
              <Link
                href={projectHref(entry.projectId)}
                className="truncate text-xs font-medium text-fg-secondary transition-colors hover:text-fg-primary"
              >
                {entry.projectTitle}
              </Link>
              <span className="flex-1" />
              <span className={cn("text-[11px] tabular-nums", tone.text)}>
                {t("workloadOpen", { count: entry.open })}
              </span>
              {panel && (
                <span className="text-[11px] tabular-nums text-fg-quaternary">
                  {quietLabel(entry.lastTouchedAt)}
                </span>
              )}
            </div>
            <span className="h-1.5 overflow-hidden rounded-sm bg-fg-primary/[0.07]">
              <span
                className={cn("block h-full rounded-sm", tone.bar)}
                style={{ width: `${Math.round((entry.open / maxOpen) * 100)}%` }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Leaderboard                                                      */
/*                                                                    */
/*  Every block is a button: clicking one opens that person's record.  */
/* ------------------------------------------------------------------ */

type LeaderboardProps = {
  people: LeaderboardPerson[];
  activeId: string | null;
  onSelect: (userId: string) => void;
};

export function Leaderboard({ people, activeId, onSelect }: LeaderboardProps) {
  const t = useTranslations("progress.record");
  const board = buildBoard(people);

  if (!board.length) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className={SECTION_TITLE}>{t("boardTitle")}</h2>
        <span className="text-[11px] text-fg-tertiary">{t("boardSubtitle")}</span>
      </div>

      <div className={cn(PANEL, "flex items-end gap-6 overflow-x-auto px-6 pt-6 sm:gap-11")}>
        {board.map((person) => {
          const name = displayName(person) || t("boardUnknown");
          const active = person.id === activeId;

          return (
            <button
              key={person.id}
              type="button"
              onClick={() => onSelect(person.id)}
              title={t("boardOpenPerson", { name })}
              aria-label={t("boardOpenPerson", { name })}
              className={cn(
                "group flex min-w-[92px] flex-1 flex-col items-center gap-2 rounded-t-md transition-colors",
                active && "bg-accent-primary/[0.07]",
              )}
            >
              <span
                className={cn(
                  "text-[13px] font-semibold tabular-nums",
                  person.isSelf ? "text-accent-primary" : "text-fg-secondary",
                )}
              >
                {person.completed}
              </span>

              <span
                className={cn(
                  "w-full max-w-[76px] rounded-t-sm transition-opacity group-hover:opacity-80",
                  person.isSelf ? "bg-accent-primary" : "bg-fg-primary/[0.17]",
                )}
                style={{ height: person.barHeight }}
              />

              <span className="flex w-full items-center justify-center gap-2 border-t border-border-medium px-1 pt-3 pb-4">
                {/* Initials, not the avatar: the design draws them, and an
                    avatar on an unconfigured host would fail next/image. */}
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    person.isSelf
                      ? "bg-accent-primary text-white"
                      : "bg-fg-quaternary text-bg-primary",
                  )}
                >
                  {initialsOf(person)}
                </span>
                <span
                  className={cn(
                    "truncate text-xs font-semibold",
                    person.isSelf ? "text-fg-primary" : "text-fg-secondary",
                  )}
                >
                  {name}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
