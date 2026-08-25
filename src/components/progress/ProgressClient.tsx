"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { ProgressGrid } from "./ProgressGrid";
import {
  FinishedLog,
  Leaderboard,
  StatColumn,
  StatRow,
  SuggestionList,
  WorkloadList,
  useRecordStats,
} from "./ProgressPanels";
import {
  RECORD_DAYS,
  RECORD_WEEKS,
  WINDOW_KEYS,
  buildGrid,
  buildLog,
  buildSuggestions,
  countByDay,
  displayName,
  initialsOf,
  normaliseEntries,
  startOfDayLocal,
  summarise,
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

function ProgressSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-7 p-4 sm:p-6 lg:p-8">
      <div className="h-9 w-80 animate-pulse rounded-lg bg-bg-secondary" />
      <div className="h-6 w-full max-w-lg animate-pulse rounded-lg bg-bg-secondary" />
      <div className="h-40 w-full animate-pulse rounded-xl bg-bg-secondary" />
      <div className="h-56 w-full animate-pulse rounded-xl bg-bg-secondary" />
    </div>
  );
}

function ProgressWorkspace({ today }: { today: Date }) {
  const t = useTranslations("progress.record");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : locale;

  /** `null` is the reader's own record; a person id opens their profile. */
  const [personId, setPersonId] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>("month");
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const board = api.progress.getLeaderboard.useQuery(undefined, { staleTime: 30_000 });
  const record = api.progress.getRecord.useQuery(
    { userId: personId ?? undefined, days: RECORD_DAYS },
    { staleTime: 30_000 },
  );

  const openPerson = useCallback((userId: string) => {
    setPersonId(userId);
    setSelectedYmd(null);
  }, []);

  const closePerson = useCallback(() => {
    setPersonId(null);
    setSelectedYmd(null);
  }, []);

  const changeWindow = useCallback((next: WindowKey) => {
    setWindowKey(next);
    setSelectedYmd(null);
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  const data = record.data;

  const tasks = useMemo(() => normaliseEntries(data?.entries), [data?.entries]);
  const counts = useMemo(() => countByDay(tasks), [tasks]);
  const weeks = useMemo(
    () => buildGrid({ today, counts, window: windowKey }),
    [today, counts, windowKey],
  );
  const summary = useMemo(
    () => summarise({ today, counts, window: windowKey }),
    [today, counts, windowKey],
  );
  const log = useMemo(
    () => buildLog({ today, tasks, window: windowKey, selectedYmd }),
    [today, tasks, windowKey, selectedYmd],
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

  const stats = useRecordStats(summary, locale);

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
      daySelected: (day: string) => t("gridDaySelected", { day }),
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
      <div className="p-6">
        <p className="text-sm text-error">{errorMessage}</p>
      </div>
    );
  }
  if (!data) return <ProgressSkeleton />;

  const name = displayName(data.person);
  const firstName = name.split(/\s+/)[0] ?? name;
  const windowLine = `${t(WINDOW_SINCE_KEYS[windowKey], { weeks: RECORD_WEEKS })} · ${t("perDayAverage", { perDay: summary.perDay })}`;
  /* A workspace with nothing finished and nothing open needs a sentence, not
     an unexplained empty grid. */
  const isBlank = data.allTimeCompleted === 0 && data.workload.length === 0;

  const grid = (
    <ProgressGrid
      weeks={weeks}
      selectedYmd={selectedYmd}
      onSelect={setSelectedYmd}
      showWeekdays={!personId}
      weekdayLabels={weekdayLabels}
      formatMonth={formatMonth}
      formatDay={formatDay}
      labels={gridLabels}
    />
  );

  const windowToggle = (
    <span className="flex overflow-hidden rounded-lg border border-border-medium">
      {WINDOW_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => changeWindow(key)}
          aria-pressed={windowKey === key}
          className={cn(
            "h-8 px-3.5 text-xs font-semibold transition-colors",
            windowKey === key
              ? "bg-accent-primary/15 text-accent-primary"
              : "text-fg-tertiary hover:bg-bg-secondary",
          )}
        >
          {t(WINDOW_LABEL_KEYS[key])}
        </button>
      ))}
    </span>
  );

  const leaderboard = (
    <Leaderboard
      people={board.data?.people ?? []}
      activeId={personId}
      onSelect={openPerson}
    />
  );

  /* ---------------- The person profile (a leaderboard block) ---------------- */

  if (personId) {
    return (
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <aside className="flex w-full shrink-0 flex-col gap-6 border-b border-border-light bg-bg-surface px-6 py-7 lg:w-[330px] lg:border-b-0 lg:border-r">
          <button
            type="button"
            onClick={closePerson}
            className="flex w-fit items-center gap-2 text-xs font-semibold text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            <ArrowLeft size={14} />
            {t("profileBack")}
          </button>

          <div className="flex items-center gap-3.5">
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent-primary text-[19px] font-bold text-white">
              {initialsOf(data.person)}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-fg-primary">
                {name || t("boardUnknown")}
              </span>
              <span className="text-[11px] tabular-nums text-fg-tertiary">
                {data.isSelf ? `${t("profileYou")} · ` : ""}
                {t("profileProjects", { count: data.workload.length })}
              </span>
            </span>
          </div>

          <StatColumn stats={stats} />

          <SuggestionList suggestions={suggestions} onDismiss={dismiss} variant="stacked" />

          <div className="flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-[0.14em] text-fg-tertiary">
              {t("workloadShort")}
            </span>
            <WorkloadList workload={data.workload} today={today} variant="bare" />
          </div>
        </aside>

        <div className="kairos-stagger flex min-w-0 flex-1 flex-col gap-7 px-4 py-7 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[28px] font-semibold leading-none tracking-[-0.025em] text-fg-primary">
                {t("headlineFinished", { count: summary.finished })}
              </h1>
              <span className="text-sm text-fg-secondary">{windowLine}</span>
            </div>
            <span className="flex-1" />
            {windowToggle}
          </div>

          {grid}

          <FinishedLog
            groups={log}
            selectedYmd={selectedYmd}
            onClearDay={() => setSelectedYmd(null)}
            variant="boxed"
            today={today}
          />

          {leaderboard}
        </div>
      </div>
    );
  }

  /* ---------------- The reader's own record ---------------- */

  return (
    <div className="kairos-stagger mx-auto flex max-w-[1400px] flex-col gap-7 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.16em] text-fg-tertiary">
            {t("eyebrow")}
          </span>
          <h1 className="text-[32px] font-semibold leading-none tracking-[-0.025em] text-fg-primary">
            {firstName
              ? t("headlinePerson", { name: firstName, count: summary.finished })
              : t("headlineFinished", { count: summary.finished })}
          </h1>
          <span className="text-sm text-fg-secondary">{windowLine}</span>
          {isBlank && <span className="text-sm text-fg-tertiary">{t("emptyHint")}</span>}
        </div>
        <span className="flex-1" />
        {windowToggle}
      </div>

      <StatRow stats={stats.slice(0, 3)} />

      <section className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg-primary">
            {t("gridTitle")}
          </h2>
          <span className="text-[11px] text-fg-tertiary">
            {t("gridSubtitle", { weeks: RECORD_WEEKS })}
          </span>
        </div>
        <div className="rounded-xl border border-border-light bg-bg-elevated px-5 py-4">
          {grid}
        </div>
      </section>

      <SuggestionList suggestions={suggestions} onDismiss={dismiss} variant="rows" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <FinishedLog
          groups={log}
          selectedYmd={selectedYmd}
          onClearDay={() => setSelectedYmd(null)}
          variant="rows"
          today={today}
        />

        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg-primary">
            {t("workloadTitle")}
          </h2>
          <WorkloadList workload={data.workload} today={today} variant="panel" />
        </div>
      </div>

      {leaderboard}
    </div>
  );
}
