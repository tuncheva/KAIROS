"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "~/components/ui/icons";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "~/lib/utils";
import {
  SUGGESTION_TEXT,
  buildBoard,
  daysBetween,
  displayName,
  formatTook,
  initialsOf,
  projectTone,
  type LeaderboardPerson,
  type LogGroup,
  type RecordSummary,
  type Suggestion,
  type TeamNote,
  type TeamRow,
  type TeamSortKey,
  type TeamSummary,
  type WorkloadEntry,
} from "./progressModel";

/** Where a project opens. Same target the dashboard and /projects use. */
export const projectHref = (id: number) => `/projects?projectId=${id}`;

/** The redesign names the priority in the "pick this up next" line. */
const PRIORITY_LABEL_KEYS: Record<string, string> = {
  urgent: "priorityUrgent",
  high: "priorityHigh",
  medium: "priorityMedium",
  low: "priorityLow",
};

/* ------------------------------------------------------------------ */
/*  The page's vocabulary                                              */
/*                                                                    */
/*  The front door's dialect, carried onto the dashboard's paper: a    */
/*  mono stamp for labels, the display serif for anything a reader     */
/*  compares, hairlines from the ink at low opacity for structure.     */
/* ------------------------------------------------------------------ */

export const STAMP = "font-mono text-[10px] tracking-[0.2em] uppercase text-tui-ink3";
const NUMERAL = "font-display tabular-nums leading-none";
const RULE = "border-tui-ink/10";
const HAIR = "border-tui-ink/[0.06]";

/** A section's head: serif title, a quiet meta line, anything on the right. */
export function SectionHead({
  title,
  meta,
  children,
  id,
}: {
  title: string;
  meta?: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3.5 gap-y-2 border-b pb-[18px]", RULE)}>
      <h2 id={id} className="font-display text-tui-ink m-0 text-[28px] leading-none font-normal">
        {title}
      </h2>
      {meta && <span className="text-tui-ink3 text-[13px]">{meta}</span>}
      {children && (
        <>
          <span className="flex-1" />
          {children}
        </>
      )}
    </div>
  );
}

/** Text tabs with an accent rule under the one that is on. */
export function TextTabs<K extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  options: { key: K; label: string }[];
  value: K;
  onChange: (next: K) => void;
  size?: "md" | "sm";
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex items-center", size === "md" ? "gap-[22px]" : "gap-[18px]")}>
      {options.map((option) => {
        const on = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={on}
            className={cn(
              "border-b-[1.5px] font-semibold transition-colors",
              size === "md" ? "h-10 text-[13.5px]" : "pb-1 text-[13px]",
              on
                ? "border-tui-accent text-tui-ink"
                : "text-tui-ink3 hover:text-tui-ink border-transparent",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats                                                            */
/* ------------------------------------------------------------------ */

export type Stat = {
  key: string;
  label: string;
  value: string;
  note: string;
  /** Tailwind text colour for the value; the default is plain ink. */
  valueClass?: string;
};

/** Finished / per day / streak / best day — the four numbers on a record. */
export function useRecordStats(summary: RecordSummary, locale: string): Stat[] {
  const t = useTranslations("progress.record");
  const running = summary.streak >= 3;

  return [
    {
      key: "finished",
      label: t("statFinished"),
      value: String(summary.finished),
      note: t("statInDays", { count: summary.days }),
    },
    {
      key: "perDay",
      label: t("statPerDay"),
      value: summary.perDay,
      note: t("statAvg"),
    },
    {
      key: "streak",
      label: t("statStreak"),
      value: t("streakDays", { count: summary.streak }),
      valueClass: running ? "text-tui-ok" : "text-tui-warn",
      note: running ? t("streakRunning") : t("streakFragile"),
    },
    {
      key: "best",
      label: t("statBestDay"),
      value: String(summary.bestCount),
      note: summary.bestDay
        ? summary.bestDay.toLocaleDateString(locale === "bg" ? "bg-BG" : locale, {
            weekday: "short",
            day: "numeric",
            month: "short",
          })
        : "—",
    },
  ];
}

export function useTeamStats(summary: TeamSummary): Stat[] {
  const t = useTranslations("progress.record");
  return [
    {
      key: "finished",
      label: t("statTeamFinished"),
      value: String(summary.finished),
      note: t("statInDays", { count: summary.days }),
    },
    {
      key: "active",
      label: t("statActive"),
      value: `${summary.activeThisWeek}/${summary.members}`,
      note: t("statActiveNote"),
    },
    {
      key: "median",
      label: t("statMedian"),
      value: String(summary.medianFinished),
      note: t("statMedianNote"),
    },
    {
      key: "attention",
      label: t("statAttention"),
      value: String(summary.attention),
      valueClass: summary.attention > 0 ? "text-tui-danger" : undefined,
      note: t("statAttentionNote"),
    },
  ];
}

/** Four numbers along one rule, divided by hairlines — two by two on a phone. */
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className={cn("grid grid-cols-2 border-y lg:grid-cols-4", RULE)}>
      {stats.map((stat, index) => (
        <div
          key={stat.key}
          className={cn(
            "flex flex-col gap-3 py-[26px] pr-6",
            RULE,
            // Left rule on every cell but the first of its row.
            index % 2 === 1 && "border-l pl-6 lg:pl-7",
            index === 2 && "border-t pl-0 lg:border-t-0 lg:border-l lg:pl-7",
            index === 3 && "border-t lg:border-t-0",
          )}
        >
          <span className={STAMP}>{stat.label}</span>
          <span className={cn(NUMERAL, "text-[44px] sm:text-[56px]", stat.valueClass ?? "text-tui-ink")}>
            {stat.value}
          </span>
          <span className="text-tui-ink3 text-[12.5px]">{stat.note}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Suggestions                                                      */
/* ------------------------------------------------------------------ */

const NUMERALS = ["i.", "ii.", "iii.", "iv.", "v."];

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

export function SuggestionList({
  suggestions,
  onDismiss,
}: {
  suggestions: Suggestion[];
  onDismiss: (id: string) => void;
}) {
  const t = useTranslations("progress.record");
  const copyFor = useSuggestionCopy();

  return (
    <section>
      <SectionHead title={t("suggestions")} />

      {suggestions.length === 0 && (
        <p className="text-tui-ink3 py-[18px] text-[14px]">{t("suggestionsEmpty")}</p>
      )}

      {suggestions.map((suggestion, index) => {
        const copy = copyFor(suggestion);
        return (
          <div key={suggestion.id} className={cn("flex gap-4 border-b py-5", HAIR)}>
            <span
              className={cn(
                "font-display pt-px text-[20px] leading-[1.1] italic",
                SUGGESTION_TEXT[suggestion.tone],
              )}
              aria-hidden="true"
            >
              {NUMERALS[index]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-tui-ink text-[14.5px] leading-[1.45] font-semibold">
                {copy.title}
              </span>
              <span className="text-tui-ink2 text-[13.5px] leading-[1.6]">{copy.body}</span>
              {copy.cta && copy.href && (
                <Link
                  href={copy.href}
                  className="text-tui-accent hover:text-tui-ink mt-1 self-start text-[13px] font-semibold transition-colors"
                >
                  {copy.cta} →
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(suggestion.id)}
              aria-label={t("dismiss")}
              title={t("dismiss")}
              className="border-tui-ink/10 text-tui-ink3 hover:border-tui-ink/30 hover:text-tui-ink grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  The finished log                                                 */
/* ------------------------------------------------------------------ */

export function FinishedLog({
  groups,
  today,
  compact = false,
}: {
  groups: LogGroup[];
  today: Date;
  /** The drawer's version: no project column, no heading of its own. */
  compact?: boolean;
}) {
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

  if (!groups.length) {
    return <p className="text-tui-ink3 py-6 text-[14px]">{t("logEmpty")}</p>;
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.ymd} className="flex flex-col">
          <span className={cn(STAMP, compact ? "pt-4 pb-2" : "pt-[22px] pb-2.5")}>
            {dayLabel(group.date)}
          </span>

          {group.items.map((item) => (
            <Link
              key={item.id}
              href={projectHref(item.projectId)}
              /* Narrower fixed columns on a phone: a wide project column left
                 the task title about 80px of a 375px screen. */
              className={cn(
                "grid items-center gap-3 border-t py-3 transition-colors hover:bg-tui-ink/[0.025] sm:gap-[18px]",
                HAIR,
                compact
                  ? "grid-cols-[minmax(0,1fr)_44px]"
                  : "grid-cols-[minmax(0,1fr)_96px_40px] sm:grid-cols-[minmax(0,1fr)_170px_44px]",
              )}
            >
              <span className="text-tui-ink truncate text-[14.5px]">{item.title}</span>
              {!compact && (
                <span className="flex min-w-0 items-center gap-[9px]">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", projectTone(item.projectId).dot)} />
                  <span className="text-tui-ink2 truncate text-[13px]">{item.projectTitle}</span>
                </span>
              )}
              <span className="text-tui-ink3 text-right font-mono text-[11.5px]">
                {took(item.tookDays)}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Remaining workload                                               */
/*                                                                    */
/*  The dashboard's "Today" row: a label, a dotted leader, the number  */
/*  in the serif. Read down the right edge like a ledger.              */
/* ------------------------------------------------------------------ */

export function WorkloadList({
  workload,
  today,
  showQuiet = true,
}: {
  workload: {
    projectId: number;
    projectTitle: string;
    open: number;
    lastTouchedAt?: WorkloadEntry["lastTouchedAt"];
  }[];
  today: Date;
  /** The drawer's copy has no touch dates to show. */
  showQuiet?: boolean;
}) {
  const t = useTranslations("progress.record");

  if (!workload.length) {
    return <p className="text-tui-ink3 text-[14px]">{t("workloadEmpty")}</p>;
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {workload.map((entry) => {
        const quiet = entry.lastTouchedAt ? daysBetween(new Date(entry.lastTouchedAt), today) : null;
        return (
          <Link
            key={entry.projectId}
            href={projectHref(entry.projectId)}
            className="text-tui-ink2 hover:text-tui-ink flex items-baseline gap-2.5 text-[14px] transition-colors"
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 -translate-y-0.5 rounded-full", projectTone(entry.projectId).dot)} />
            <span className="min-w-0 truncate">{entry.projectTitle}</span>
            <span className="border-tui-ink/20 min-w-4 flex-1 -translate-y-1 border-b border-dotted" />
            {showQuiet && quiet !== null && (
              <span className={cn("shrink-0 text-[12px]", quiet >= 7 ? "text-tui-danger" : "text-tui-ink3")}>
                {quiet <= 0 ? t("workloadToday") : t("workloadQuiet", { count: quiet })}
              </span>
            )}
            <span className={cn(NUMERAL, "text-tui-ink min-w-7 text-right text-[28px]")}>{entry.open}</span>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Standings                                                        */
/*                                                                    */
/*  Every row but your own opens that person's record in the drawer.   */
/* ------------------------------------------------------------------ */

export function Standings({
  people,
  onOpen,
}: {
  people: LeaderboardPerson[];
  onOpen: (userId: string) => void;
}) {
  const t = useTranslations("progress.record");
  const board = buildBoard(people);

  if (!board.length) return null;

  return (
    <section>
      <SectionHead title={t("boardTitle")} meta={t("boardSubtitle")} />
      {board.map((person) => {
        const name = displayName(person) || t("boardUnknown");
        const row = (
          <>
            <span className={cn(NUMERAL, "text-tui-ink3 text-[24px] italic")}>{person.rank}</span>
            <span
              className={cn(
                "grid h-[30px] w-[30px] place-items-center rounded-full text-[11px] font-bold",
                person.isSelf ? "bg-tui-accent text-tui-on-accent" : "bg-tui-ink/10 text-tui-ink2",
              )}
            >
              {person.initials}
            </span>
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span className="text-tui-ink truncate text-[14.5px] font-semibold">{name}</span>
              {person.isSelf && (
                <span className="text-tui-accent font-mono text-[9.5px] tracking-[0.2em] uppercase">
                  {t("profileYou")}
                </span>
              )}
            </span>
            <span className="bg-tui-ink/[0.07] hidden h-0.5 sm:block">
              <span
                className={cn("block h-full", person.isSelf ? "bg-tui-accent" : "bg-tui-ink/30")}
                style={{ width: `${Math.round(person.share * 100)}%` }}
              />
            </span>
            <span className={cn(NUMERAL, "text-tui-ink text-right text-[30px]")}>{person.completed}</span>
          </>
        );
        const grid = cn(
          "grid w-full grid-cols-[32px_30px_minmax(0,1fr)_64px] items-center gap-3.5 border-b py-3.5 text-left sm:grid-cols-[44px_34px_240px_minmax(0,1fr)_76px] sm:gap-[18px]",
          HAIR,
        );

        return person.isSelf ? (
          <div key={person.id} className={grid}>
            {row}
          </div>
        ) : (
          <button
            key={person.id}
            type="button"
            onClick={() => onOpen(person.id)}
            aria-label={t("boardOpenPerson", { name })}
            className={cn(grid, "hover:bg-tui-ink/[0.025] transition-colors")}
          >
            {row}
          </button>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  The team table                                                   */
/* ------------------------------------------------------------------ */

export function roleLabel(
  t: (key: string) => string,
  member: { role: string; displayRole: string | null },
): string {
  if (member.displayRole?.trim()) return member.displayRole.trim();
  switch (member.role) {
    case "admin":
      return t("roleAdmin");
    case "worker":
      return t("roleWorker");
    case "mentor":
      return t("roleMentor");
    case "guest":
      return t("roleGuest");
    default:
      return t("roleMember");
  }
}

const TABLE_COLUMNS =
  "grid-cols-[250px_minmax(210px,1fr)_84px_76px_76px_64px_118px] gap-5";

export function TeamTable({
  rows,
  sort,
  onSort,
  onOpen,
  activeId,
}: {
  rows: TeamRow[];
  sort: TeamSortKey;
  onSort: (key: TeamSortKey) => void;
  onOpen: (userId: string) => void;
  activeId: string | null;
}) {
  const t = useTranslations("progress.record");
  /* One scale for every row, so a strip of single-task days does not stand as
     tall as a colleague's busiest week — the column exists to be compared
     down, not read across. */
  const peak = Math.max(1, ...rows.flatMap((row) => row.strip));

  return (
    <section aria-labelledby="progress-members">
      <SectionHead
        id="progress-members"
        title={t("membersTitle")}
        meta={t("membersSubtitle", { count: rows.length })}
      >
        <span className="flex items-center gap-4">
          <span className={STAMP}>{t("sortLabel")}</span>
          <TextTabs
            label={t("sortLabel")}
            size="sm"
            value={sort}
            onChange={onSort}
            options={[
              { key: "finished", label: t("sortFinished") },
              { key: "streak", label: t("sortStreak") },
              { key: "open", label: t("sortOpen") },
              { key: "quiet", label: t("sortQuiet") },
            ]}
          />
        </span>
      </SectionHead>

      {/* Seven columns do not fold gracefully, so a narrow screen scrolls the
          table sideways rather than dropping the numbers a lead came for. */}
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div className={cn("grid pt-4 pb-2.5", TABLE_COLUMNS, STAMP)} aria-hidden="true">
            <span>{t("colMember")}</span>
            <span>{t("colLast30")}</span>
            <span className="text-right">{t("colFinished")}</span>
            <span className="text-right">{t("colPerDay")}</span>
            <span className="text-right">{t("colStreak")}</span>
            <span className="text-right">{t("colOpen")}</span>
            <span className="text-right">{t("colLastFinished")}</span>
          </div>

          {rows.map((row) => {
            const name = displayName(row.member) || t("boardUnknown");
            const last =
              row.lastFinishedDays === null
                ? "—"
                : row.lastFinishedDays === 0
                  ? t("workloadToday")
                  : t("lastDaysAgo", { count: row.lastFinishedDays });

            return (
              <button
                key={row.member.id}
                type="button"
                onClick={() => onOpen(row.member.id)}
                aria-label={t("boardOpenPerson", { name })}
                className={cn(
                  "grid w-full items-center border-t py-4 text-left transition-colors",
                  TABLE_COLUMNS,
                  "border-tui-ink/[0.07]",
                  activeId === row.member.id ? "bg-tui-accent/[0.06]" : "hover:bg-tui-ink/[0.025]",
                )}
              >
                <span className="flex min-w-0 items-center gap-3.5">
                  <span
                    className={cn(
                      "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[11.5px] font-bold",
                      row.member.isSelf ? "bg-tui-accent text-tui-on-accent" : "bg-tui-ink/10 text-tui-ink2",
                    )}
                  >
                    {initialsOf(row.member)}
                  </span>
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    <span className="text-tui-ink truncate text-[14.5px] font-semibold">{name}</span>
                    <span className="text-tui-ink3 font-mono text-[9.5px] tracking-[0.18em] uppercase">
                      {roleLabel(t, row.member)}
                      {row.member.isSelf ? ` · ${t("profileYou")}` : ""}
                    </span>
                  </span>
                </span>

                {/* The last thirty days, one bar each — shape over precision. */}
                <span aria-hidden="true" className="flex h-[26px] items-end gap-[3px]">
                  {row.strip.map((count, index) => (
                    <span
                      key={index}
                      className={cn(
                        "w-1 rounded-[1px]",
                        count === 0
                          ? "bg-tui-ink/[0.12]"
                          : row.member.isSelf
                            ? "bg-tui-accent"
                            : "bg-tui-ink/45",
                      )}
                      style={{ height: count === 0 ? 2 : Math.max(5, Math.round((count / peak) * 26)) }}
                    />
                  ))}
                </span>

                <span className={cn(NUMERAL, "text-tui-ink text-right text-[28px]")}>{row.finished}</span>
                <span className="text-tui-ink2 text-right text-[14px] tabular-nums">{row.perDay}</span>
                <span
                  className={cn(
                    "text-right text-[14px] tabular-nums",
                    row.streak >= 3 ? "text-tui-ok" : "text-tui-ink3",
                  )}
                >
                  {t("streakDays", { count: row.streak })}
                </span>
                <span
                  className={cn(
                    "text-right text-[14px] tabular-nums",
                    row.heavy ? "text-tui-warn" : "text-tui-ink2",
                  )}
                >
                  {row.open}
                </span>
                <span className={cn("text-right text-[13px]", row.quiet ? "text-tui-danger" : "text-tui-ink3")}>
                  {last}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Worth a look                                                     */
/* ------------------------------------------------------------------ */

export function TeamNotes({
  notes,
  onOpenMember,
}: {
  notes: TeamNote[];
  onOpenMember: (userId: string) => void;
}) {
  const t = useTranslations("progress.record");

  return (
    <section>
      <SectionHead title={t("attentionTitle")} meta={t("attentionSubtitle")} />
      {notes.length === 0 ? (
        <p className="text-tui-ink3 pt-6 text-[14px]">{t("attentionEmpty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-10 pt-7 md:grid-cols-3 md:gap-12">
          {notes.map((note, index) => {
            const action =
              note.id === "stale" ? (
                <Link
                  href={projectHref(note.projectId)}
                  className="text-tui-accent hover:text-tui-ink mt-0.5 self-start text-[13px] font-semibold transition-colors"
                >
                  {t("staleCta")} →
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenMember(note.memberId)}
                  className="text-tui-accent hover:text-tui-ink mt-0.5 self-start text-[13px] font-semibold transition-colors"
                >
                  {t("noteOpenRecord")} →
                </button>
              );

            const title =
              note.id === "quiet"
                ? note.days === null
                  ? t("noteQuietNeverTitle", { name: note.name })
                  : t("noteQuietTitle", { name: note.name, days: note.days })
                : note.id === "heavy"
                  ? t("noteHeavyTitle", { name: note.name, count: note.open })
                  : t("staleTitle", { project: note.projectTitle, days: note.quietDays });
            const body =
              note.id === "quiet"
                ? t("noteQuietBody", { count: note.open })
                : note.id === "heavy"
                  ? t("noteHeavyBody", { median: note.median })
                  : t("noteStaleBody", { count: note.open, people: note.people });

            return (
              <div key={note.id} className="flex flex-col gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn("font-display text-[22px] leading-none italic", SUGGESTION_TEXT[note.tone])}
                >
                  {NUMERALS[index]}
                </span>
                <span className="text-tui-ink text-[15px] leading-[1.45] font-semibold">{title}</span>
                <span className="text-tui-ink2 text-[13.5px] leading-[1.6]">{body}</span>
                {action}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
