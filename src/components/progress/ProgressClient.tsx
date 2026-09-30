"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { exitDurationMs } from "~/components/ui/drawerExit";
import { HeatLegend, ProgressGrid } from "./ProgressGrid";
import { MemberDrawer } from "./ProgressDrawer";
import {
  FinishedLog,
  SectionHead,
  STAMP,
  Standings,
  StatRow,
  SuggestionList,
  TeamNotes,
  TeamTable,
  TextTabs,
  WorkloadList,
  projectHref,
  useRecordStats,
  useTeamStats,
} from "./ProgressPanels";
import {
  RECORD_DAYS,
  RECORD_WEEKS,
  WINDOW_KEYS,
  buildGrid,
  buildLog,
  buildSuggestions,
  buildTeamNotes,
  buildTeamRows,
  countByDay,
  countLogged,
  displayName,
  fromYmd,
  mergeCounts,
  normaliseEntries,
  projectTone,
  sortTeamRows,
  startOfDayLocal,
  summarise,
  summariseTeam,
  tasksByDay,
  teamHeatLevel,
  toYmd,
  type TeamSortKey,
  type WindowKey,
} from "./progressModel";

const WINDOW_LABEL_KEYS: Record<WindowKey, string> = {
  week: "windowWeek",
  month: "windowMonth",
  all: "windowAll",
};

const WINDOW_SINCE_KEYS: Record<WindowKey, string> = {
  week: "sinceWeek",
  month: "sinceMonth",
  all: "sinceAll",
};

type Scope = "me" | "team";

/**
 * Which day is "today", which cell is inside the window and where the streak
 * ends are all questions about the reader's clock. The server answers them in
 * its own timezone at its own instant, so rendering the grid during SSR is a
 * guaranteed hydration mismatch. Hold a skeleton until the browser clock is
 * known, then build the record from it — client-side, once.
 */
export function ProgressClient() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(startOfDayLocal(new Date())), []);

  if (!today) return <ProgressSkeleton />;
  return <ProgressWorkspace today={today} />;
}

/** The sheet the page sits on: one quiet surface over the dashboard's hatch. */
function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="tui-screen text-tui-ink min-h-full">
      <div className="mx-auto max-w-[1360px] px-3 pt-4 pb-8 sm:px-6 sm:pt-6">
        <article className="border-tui-ink/10 bg-tui-pane rounded-[10px] border px-4 pt-4 pb-10 shadow-[var(--tui-pane-shadow)] sm:px-8 lg:px-12 lg:pt-6 lg:pb-12">
          {children}
        </article>
      </div>
    </div>
  );
}

function ProgressSkeleton() {
  return (
    <Sheet>
      <div className="flex flex-col gap-8" aria-hidden="true">
        <div className="kairos-shimmer h-10 w-72 max-w-full rounded-md" />
        <div className="kairos-shimmer mt-8 h-16 w-[560px] max-w-full rounded-md" />
        <div className="kairos-shimmer h-28 w-full rounded-md" />
        <div className="kairos-shimmer h-56 w-full rounded-md" />
      </div>
    </Sheet>
  );
}

function ProgressWorkspace({ today }: { today: Date }) {
  const t = useTranslations("progress.record");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : locale;

  const [scope, setScope] = useState<Scope>("me");
  const [windowKey, setWindowKey] = useState<WindowKey>("month");
  const [selectedYmd, setSelectedYmd] = useState<string>(() => toYmd(today));
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [sort, setSort] = useState<TeamSortKey>("finished");

  /** The teammate whose record is open in the drawer. */
  const [personId, setPersonId] = useState<string | null>(null);
  /* React unmounts on the same tick it re-renders, so a drawer that is simply
     dropped can never play an exit. `closing` keeps it mounted for exactly as
     long as the animation runs. */
  const [closing, setClosing] = useState(false);

  const board = api.progress.getLeaderboard.useQuery(undefined, { staleTime: 30_000 });
  const canViewTeam = board.data?.canViewTeam ?? false;
  const team = scope === "team" && canViewTeam;

  const record = api.progress.getRecord.useQuery({ days: RECORD_DAYS }, { staleTime: 30_000 });
  const teamQuery = api.progress.getTeam.useQuery(
    { days: RECORD_DAYS },
    { staleTime: 30_000, enabled: team },
  );

  const openPerson = useCallback((userId: string) => {
    setClosing(false);
    setPersonId(userId);
  }, []);
  const closePerson = useCallback(() => setClosing(true), []);

  /* Dropped on a timer rather than on `animationend`: under reduced motion
     the animation is off entirely and no such event would ever arrive. */
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setClosing(false);
      setPersonId(null);
    }, exitDurationMs());
    return () => window.clearTimeout(timer);
  }, [closing]);

  const changeScope = useCallback((next: Scope) => {
    setScope(next);
    setPersonId(null);
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  /* ── My record ─────────────────────────────────────────────────── */

  const data = record.data;
  const tasks = useMemo(() => normaliseEntries(data?.entries), [data?.entries]);
  const myCounts = useMemo(() => countByDay(tasks), [tasks]);
  const myTasksByDay = useMemo(() => tasksByDay(tasks), [tasks]);
  const summary = useMemo(
    () => summarise({ today, counts: myCounts, window: windowKey }),
    [today, myCounts, windowKey],
  );
  const log = useMemo(
    () => buildLog({ today, tasks, window: windowKey, selectedYmd: null }),
    [today, tasks, windowKey],
  );
  const suggestions = useMemo(
    () =>
      buildSuggestions({
        today,
        summary,
        workload: data?.workload ?? [],
        nextTask: data?.nextTask ?? null,
      }).filter((suggestion) => !dismissed.includes(suggestion.id)),
    [today, summary, data?.workload, data?.nextTask, dismissed],
  );
  const myStats = useRecordStats(summary, locale);

  /* ── Team ──────────────────────────────────────────────────────── */

  const teamData = teamQuery.data;
  const teamRows = useMemo(
    () =>
      teamData
        ? buildTeamRows({
            today,
            members: teamData.members,
            completions: teamData.completions,
            window: windowKey,
          })
        : [],
    [today, teamData, windowKey],
  );
  const sortedRows = useMemo(() => sortTeamRows(teamRows, sort), [teamRows, sort]);
  const teamCountsByDay = useMemo(() => mergeCounts(teamRows.map((row) => row.counts)), [teamRows]);
  const teamSummary = useMemo(() => summariseTeam(teamRows, windowKey), [teamRows, windowKey]);
  const teamNotes = useMemo(
    () => buildTeamNotes({ today, rows: teamRows, projects: teamData?.projects ?? [] }),
    [today, teamRows, teamData?.projects],
  );
  const teamStats = useTeamStats(teamSummary);

  /* ── The grid, for whichever view is on ────────────────────────── */

  const memberCount = teamRows.length;
  const weeks = useMemo(
    () =>
      buildGrid({
        today,
        counts: team ? teamCountsByDay : myCounts,
        window: windowKey,
        level: team ? (count) => teamHeatLevel(count, memberCount) : undefined,
      }),
    [today, team, teamCountsByDay, myCounts, windowKey, memberCount],
  );

  const formatMonth = useCallback(
    (date: Date) => date.toLocaleDateString(dateLocale, { month: "short" }),
    [dateLocale],
  );
  const formatDay = useCallback(
    (date: Date) =>
      date.toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short" }),
    [dateLocale],
  );
  const gridLabels = useMemo(
    () => ({
      less: t("less"),
      more: t("more"),
      hint: t("gridHint"),
      dayCount: (day: string, count: number) => t("gridDayCount", { day, count }),
    }),
    [t],
  );
  const weekdayLabels = useMemo(
    () => ({ monday: t("weekdayMon"), wednesday: t("weekdayWed"), friday: t("weekdayFri") }),
    [t],
  );

  if (record.isLoading && !data) return <ProgressSkeleton />;

  const errorMessage = record.error?.message ?? board.error?.message ?? null;
  if (errorMessage) {
    return (
      <Sheet>
        <p className="text-tui-danger text-[14px]">{errorMessage}</p>
      </Sheet>
    );
  }
  if (!data) return <ProgressSkeleton />;

  const name = displayName(data.person);
  const firstName = name.split(/\s+/)[0] ?? name;
  const since = t(WINDOW_SINCE_KEYS[windowKey], { weeks: RECORD_WEEKS });
  const em = (chunks: ReactNode) => <em className="text-tui-accent italic">{chunks}</em>;
  /* A workspace with nothing finished and nothing open needs a sentence, not
     an unexplained empty grid. */
  const isBlank = data.allTimeCompleted === 0 && data.workload.length === 0;

  const headline = team
    ? t.rich("headlineTeam", { count: teamSummary.finished, em })
    : firstName
      ? t.rich("headlinePerson", { name: firstName, count: summary.finished, em })
      : t.rich("headlineFinished", { count: summary.finished, em });

  const subline = team
    ? `${t("teamSubline", { since, count: teamSummary.members, perPerson: teamSummary.perPersonPerDay })} ${t("teamPrivacy")}`
    : `${since} · ${t("perDayAverage", { perDay: summary.perDay })}`;

  const selected = fromYmd(selectedYmd) ?? today;
  const selectedTasks = myTasksByDay.get(selectedYmd) ?? [];
  const selectedMembers = team
    ? teamRows
        .map((row) => ({ row, count: row.counts.get(selectedYmd) ?? 0 }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count)
    : [];
  const selectedTotal = team
    ? selectedMembers.reduce((total, entry) => total + entry.count, 0)
    : selectedTasks.length;

  const drawerMember = personId ? teamRows.find((row) => row.member.id === personId)?.member : undefined;

  return (
    <Sheet>
      {/* Toolbar: whose record, then over how long. */}
      <header className="flex flex-wrap items-center gap-x-7 gap-y-2">
        {canViewTeam && (
          <>
            <TextTabs
              label={t("scopeLabel")}
              value={team ? "team" : "me"}
              onChange={changeScope}
              options={[
                { key: "me", label: t("scopeMine") },
                { key: "team", label: t("scopeTeam") },
              ]}
            />
            <span aria-hidden="true" className="bg-tui-ink/15 hidden h-[18px] w-px sm:block" />
          </>
        )}
        <TextTabs
          label={t("windowLabel")}
          value={windowKey}
          onChange={setWindowKey}
          options={WINDOW_KEYS.map((key) => ({ key, label: t(WINDOW_LABEL_KEYS[key]) }))}
        />
      </header>

      <div key={team ? "team" : "me"} className="progress-view-in">
        {/* Headline */}
        <section className="mt-7 flex flex-col sm:mt-10">
          <span className="text-tui-accent font-mono text-[11px] tracking-[0.22em] uppercase">
            {team ? t("eyebrowTeam") : t("eyebrow")}
          </span>
          <h1 className="font-display m-0 mt-3.5 text-[34px] leading-none font-normal tracking-[-0.022em] text-pretty sm:text-[46px] lg:text-[56px]">
            {headline}
          </h1>
          <p className="text-tui-ink2 m-0 mt-3 max-w-[640px] text-[15px] leading-[1.6] text-pretty">
            {subline}
          </p>
          {!team && isBlank && <p className="text-tui-ink3 m-0 mt-2 text-[14px]">{t("emptyHint")}</p>}
        </section>

        <div className="mt-8">
          {team && teamQuery.isLoading ? (
            <div className="kairos-shimmer h-[112px] rounded-md" aria-hidden="true" />
          ) : (
            <StatRow stats={team ? teamStats : myStats} />
          )}
        </div>

        {team && teamQuery.error && (
          <p className="text-tui-danger mt-6 text-[14px]">{teamQuery.error.message}</p>
        )}

        {/* Finished per day, and the day that is picked, read out beside it. */}
        <section className="mt-11">
          <SectionHead
            title={team ? t("gridTitleTeam") : t("gridTitle")}
            meta={t("gridSubtitle", { weeks: RECORD_WEEKS })}
          >
            <HeatLegend less={t("less")} more={t("more")} />
          </SectionHead>

          <div className="flex flex-col lg:flex-row">
            <div className="pt-5 lg:pr-8">
              <ProgressGrid
                weeks={weeks}
                selectedYmd={selectedYmd}
                onSelect={setSelectedYmd}
                showWeekdays
                weekdayLabels={weekdayLabels}
                formatMonth={formatMonth}
                formatDay={formatDay}
                labels={gridLabels}
              />
            </div>

            <div className="border-tui-ink/[0.08] mt-6 flex min-w-0 flex-1 flex-col border-t pt-5 lg:mt-0 lg:border-t-0 lg:border-l lg:pl-8">
              <span className={STAMP}>{t("selectedDay")}</span>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-[26px] leading-[1.05]">
                  {selected.toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long" })}
                </span>
                <span className="text-tui-ink2 text-[13px]">
                  {team
                    ? t("readoutCountTeam", { count: selectedTotal, people: selectedMembers.length })
                    : t("readoutCount", { count: selectedTotal })}
                </span>
              </div>

              <div className="mt-3 flex flex-col">
                {selectedTotal === 0 && (
                  <p className="border-tui-ink/[0.07] text-tui-ink3 border-t py-2.5 text-[13.5px]">
                    {t("logEmptyDay")}
                  </p>
                )}
                {team
                  ? selectedMembers.map(({ row, count }) => (
                      <button
                        key={row.member.id}
                        type="button"
                        onClick={() => openPerson(row.member.id)}
                        className="border-tui-ink/[0.07] hover:bg-tui-ink/[0.025] flex items-center gap-3 border-t py-2 text-left transition-colors"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            row.member.isSelf ? "bg-tui-accent" : "bg-tui-ink/35",
                          )}
                        />
                        <span className="text-tui-ink min-w-0 flex-1 truncate text-[14px]">
                          {displayName(row.member) || t("boardUnknown")}
                        </span>
                        <span className="text-tui-ink3 text-[12.5px] tabular-nums">
                          {t("readoutCount", { count })}
                        </span>
                      </button>
                    ))
                  : selectedTasks.map((task) => (
                      <Link
                        key={task.id}
                        href={projectHref(task.projectId)}
                        className="border-tui-ink/[0.07] hover:bg-tui-ink/[0.025] flex items-center gap-3 border-t py-2 transition-colors"
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", projectTone(task.projectId).dot)} />
                        <span className="text-tui-ink min-w-0 flex-1 truncate text-[14px]">{task.title}</span>
                        <span className="text-tui-ink3 max-w-[40%] truncate text-[12.5px]">
                          {task.projectTitle}
                        </span>
                      </Link>
                    ))}
              </div>
            </div>
          </div>
        </section>

        {team ? (
          <>
            <div className="mt-11">
              {teamQuery.isLoading ? (
                <div className="kairos-shimmer h-72 rounded-md" aria-hidden="true" />
              ) : (
                <TeamTable
                  rows={sortedRows}
                  sort={sort}
                  onSort={setSort}
                  onOpen={openPerson}
                  activeId={closing ? null : personId}
                />
              )}
            </div>
            {!teamQuery.isLoading && (
              <div className="mt-11">
                <TeamNotes notes={teamNotes} onOpenMember={openPerson} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mt-11 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
              <section>
                <SectionHead title={t("logRecent")} meta={t("logCount", { count: countLogged(log) })} />
                <FinishedLog groups={log} today={today} />
              </section>

              <div className="flex flex-col gap-10">
                <SuggestionList suggestions={suggestions} onDismiss={dismiss} />
                <section>
                  <SectionHead title={t("workloadTitle")} />
                  <div className="pt-4">
                    <WorkloadList workload={data.workload} today={today} />
                    {data.workload.length > 0 && (
                      <p className="text-tui-ink3 mt-3 text-[12px]">{t("workloadCaption")}</p>
                    )}
                  </div>
                </section>
              </div>
            </div>

            <div className="mt-11">
              <Standings people={board.data?.people ?? []} onOpen={openPerson} />
            </div>
          </>
        )}
      </div>

      {personId && (
        <MemberDrawer
          userId={personId}
          member={drawerMember}
          closing={closing}
          onClose={closePerson}
          today={today}
          windowKey={windowKey}
          formatMonth={formatMonth}
          formatDay={formatDay}
          gridLabels={gridLabels}
        />
      )}
    </Sheet>
  );
}
