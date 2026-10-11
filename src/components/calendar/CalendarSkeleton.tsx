"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, HelpCircle, List, Plus, Search, SlidersHorizontal } from "~/components/ui/icons";
import { Skeleton, SkeletonStatus, skeletonWidth } from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";
import { cn } from "~/lib/utils";
import { ROW_HEIGHT, pad2 } from "./calendarModel";

/* ------------------------------------------------------------------ */
/*  Calendar skeletons                                                */
/*                                                                    */
/*  The grid, the hours, the day headers and the view switcher are    */
/*  known before any data is — only the items hatch. Geometry is      */
/*  copied from CalendarTimeGrid / CalendarMonthGrid / CalendarAgenda */
/*  so nothing moves when the items land.                             */
/* ------------------------------------------------------------------ */

const WEEKDAY_KEYS = [
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
  "weekdaySun",
] as const;

const VIEW_KEYS = ["day", "week", "month", "range"] as const;

/** Default hour window (`hourWindow` with no items). */
const DEFAULT_HOURS = { start: 8, end: 20 };

/** Placeholder events per column: [start offset in hours, length in hours]. */
const EVENT_PATTERN: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[1, 1.5], [4, 1]],
  [[2, 1]],
  [[0.5, 1], [3, 2], [7, 1]],
  [[5, 1.5]],
  [[1.5, 1], [6, 1]],
  [],
  [[3, 1]],
];

const GUTTER = "w-[58px]";

const OUTLINE_BTN =
  "flex h-[30px] items-center gap-1.5 rounded-lg border border-border-medium px-2.5 text-xs font-semibold text-fg-tertiary";

export type TimeColumnSkeleton = {
  /** Weekday label — known even before the clock is. */
  weekday: string;
  /** Day of the month; `undefined` hatches it (pre-hydration). */
  date?: number;
  isToday?: boolean;
};

/** The week/day time grid with its items hatched. */
export function CalendarTimeGridSkeleton({
  columns,
  hours = DEFAULT_HOURS,
  allDayLabel,
  className = "",
}: {
  columns: TimeColumnSkeleton[];
  hours?: { start: number; end: number };
  allDayLabel: string;
  className?: string;
}) {
  const span = hours.end - hours.start;
  const hourList = Array.from({ length: span }, (_, i) => hours.start + i);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-elevated",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 bg-bg-elevated">
          <div className="flex shrink-0 border-b border-border-light">
            <div className={cn(GUTTER, "shrink-0")} />
            {columns.map((column, index) => (
              <div
                key={index}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 border-l border-border-light/70 px-3 py-2.5",
                  column.isToday && "bg-now-line/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "text-[11px] uppercase tracking-[0.12em]",
                    column.isToday ? "text-now-line" : "text-fg-tertiary",
                  )}
                >
                  {column.weekday}
                </span>
                <span
                  className={cn(
                    "flex h-6 items-center text-base font-semibold tabular-nums",
                    column.isToday ? "text-now-line" : "text-fg-primary",
                  )}
                >
                  {column.date ?? <Skeleton shape="title" className="h-[12px] w-[18px]" />}
                </span>
                <span className="flex-1" />
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-border-medium bg-bg-secondary/80 text-fg-tertiary">
                  <Plus size={12} />
                </span>
              </div>
            ))}
          </div>

          <div className="flex shrink-0 border-b border-border-light bg-bg-secondary/40">
            <div
              className={cn(
                GUTTER,
                "flex shrink-0 items-center justify-end pr-2.5 text-[9px] uppercase tracking-[0.1em] text-fg-tertiary",
              )}
            >
              {allDayLabel}
            </div>
            {columns.map((_, index) => (
              <div
                key={index}
                className="flex min-h-[38px] min-w-0 flex-1 flex-col gap-1 border-l border-border-light/70 p-1.5"
              >
                {index % 3 === 1 && <Skeleton shape="title" row={0} className="h-[24px] w-full" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1">
          <div className={cn(GUTTER, "relative shrink-0")}>
            {hourList.map((hour) => (
              <div
                key={hour}
                style={{ height: ROW_HEIGHT }}
                className="border-t border-transparent pt-1 pr-2.5 text-right text-[10px] leading-none tabular-nums text-fg-tertiary"
              >
                {pad2(hour)}:00
              </div>
            ))}
          </div>

          {columns.map((column, index) => (
            <div
              key={index}
              className={cn(
                "relative min-w-0 flex-1 border-l border-border-light/70",
                column.isToday && "bg-now-line/[0.025]",
              )}
            >
              {hourList.map((hour) => (
                <div key={hour} style={{ height: ROW_HEIGHT }} className="border-t border-border-light/50" />
              ))}
              {(EVENT_PATTERN[index % EVENT_PATTERN.length] ?? [])
                .filter(([offset, length]) => offset + length <= span)
                .map(([offset, length]) => (
                  <Skeleton
                    key={offset}
                    shape="title"
                    row={Math.round(offset)}
                    className="absolute right-[4px] left-[4px]"
                    style={{
                      top: Math.round(offset * ROW_HEIGHT) + 1,
                      height: Math.max(20, Math.round(length * ROW_HEIGHT) - 2),
                    }}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export type MonthCellSkeleton = { date: number; inMonth: boolean; isToday: boolean };

/** The month grid with its chips hatched. */
export function CalendarMonthGridSkeleton({
  weekdayLabels,
  cells,
}: {
  weekdayLabels: string[];
  cells: MonthCellSkeleton[];
}) {
  const weeks: MonthCellSkeleton[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div
      aria-hidden="true"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-elevated"
    >
      <div className="grid shrink-0 grid-cols-7 border-b border-border-light">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="min-w-0 truncate px-1.5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-fg-tertiary sm:px-3"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="col-span-7 grid grid-cols-7">
            {week.map((cell, columnIndex) => {
              const index = weekIndex * 7 + columnIndex;
              // 0–2 chips a cell, deterministic so SSR and client agree.
              const chips = cell.inMonth ? [0, 1, 2, 0, 1, 0, 2][(index * 5) % 7]! : 0;
              return (
                <div
                  key={index}
                  className={cn(
                    "relative flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden border-r border-b border-border-light/60 p-1 sm:p-2",
                    !cell.inMonth && "bg-bg-secondary/60",
                    cell.isToday && "bg-accent-primary/[0.07]",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
                        cell.isToday
                          ? "bg-accent-primary text-tui-on-accent"
                          : cell.inMonth
                            ? "text-fg-primary"
                            : "text-fg-tertiary",
                      )}
                    >
                      {cell.date}
                    </span>
                    <span className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border-medium bg-bg-secondary/80 text-fg-tertiary sm:flex">
                      <Plus size={11} />
                    </span>
                  </div>
                  {Array.from({ length: chips }, (_, i) => (
                    <Skeleton
                      key={i}
                      shape="line"
                      row={weekIndex * 2}
                      className="h-[18px]"
                      style={{ width: skeletonWidth(index * 3 + i, 60, 100) }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The agenda list with its rows hatched. `heading` undefined hatches the day. */
export function CalendarAgendaSkeleton({
  days,
  className = "",
}: {
  days: { heading?: string; isToday?: boolean }[];
  className?: string;
}) {
  let row = 0;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-elevated",
        className,
      )}
    >
      {days.map((day, dayIndex) => {
        const count = 1 + ((dayIndex * 2) % 3);
        const headerRow = row++;
        return (
          <section key={dayIndex} className="border-b border-border-light last:border-b-0">
            <header
              className={cn(
                "flex items-baseline gap-2 border-b border-border-light/70 px-4 py-2",
                day.isToday ? "bg-accent-primary/[0.09]" : "bg-bg-surface/95",
              )}
            >
              <h3
                className={cn(
                  "flex h-[19.5px] items-center text-[13px] font-semibold tracking-tight",
                  day.isToday ? "text-accent-primary" : "text-fg-primary",
                )}
              >
                {day.heading ?? <Skeleton row={headerRow} className="h-[9px] w-[96px]" />}
              </h3>
              <span className="flex-1" />
              <span className="flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-md border border-border-medium text-fg-tertiary">
                <Plus size={12} />
              </span>
            </header>
            <ul className="flex flex-col">
              {Array.from({ length: count }, (_, i) => {
                const r = row++;
                return (
                  <li
                    key={i}
                    className="flex min-h-[44px] w-full items-stretch gap-3 border-b border-border-light/40 px-4 py-2 last:border-b-0"
                  >
                    <span className="w-[3.2em] shrink-0 pt-[5px] text-[11px]">
                      <Skeleton row={r} className="h-[7px] w-[30px]" />
                    </span>
                    <Skeleton row={r} className="w-[3px] self-stretch" />
                    <span className="flex min-w-0 flex-1 flex-col justify-center gap-[9px]">
                      <Skeleton
                        row={r}
                        className="h-[9px]"
                        style={{ width: skeletonWidth(dayIndex * 7 + i, 40, 75) }}
                      />
                      <Skeleton
                        row={r}
                        className="h-[7px]"
                        style={{ width: skeletonWidth(dayIndex * 7 + i + 3, 20, 40) }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Before the browser clock is known (SSR and the first client render) and as
 * the route's loading state. The weekday labels, the hours, the view switcher
 * and every control label are real; only what depends on the date — the
 * period title, the day numbers, the status line — and the items hatch.
 */
export function CalendarSkeleton() {
  const t = useTranslations("calendar.filters");
  const ts = useTranslations("skeleton");
  const weekdays = WEEKDAY_KEYS.map((key) => t(key));

  return (
    <div className="relative flex h-full flex-col gap-3 overflow-hidden px-4 py-5 sm:px-6 md:px-8">
      <SkeletonStatus label={ts("status")} />

      <div
        aria-hidden="true"
        inert
        className="relative flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border-light bg-bg-elevated px-2.5 py-2"
      >
        <div className="flex items-center gap-1">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-medium text-fg-secondary">
            <ChevronLeft size={15} />
          </span>
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-medium text-fg-secondary">
            <ChevronRight size={15} />
          </span>
          <span className="ml-1 flex h-[30px] items-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 px-2.5 text-xs font-semibold text-accent-primary">
            {t("today")}
          </span>
        </div>

        <span className="flex h-[20px] items-center px-1">
          <Skeleton shape="title" className="h-[14px] w-[150px]" />
        </span>

        <div className="flex overflow-hidden rounded-lg border border-border-medium">
          {VIEW_KEYS.map((v) => (
            <span key={v} className="flex h-[30px] items-center px-2.5 text-xs font-semibold text-fg-tertiary">
              {t(v)}
            </span>
          ))}
        </div>

        <span className="flex-1" />

        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <span className="flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-medium bg-bg-surface px-2.5 text-xs text-fg-quaternary sm:w-[190px] sm:flex-none">
            <Search size={13} className="shrink-0 text-fg-tertiary" />
            <span className="truncate">{t("searchRange")}</span>
          </span>
          <span className={cn(OUTLINE_BTN, "shrink-0")}>
            <SlidersHorizontal size={13} />
            {t("filters")}
          </span>
          <span className={cn(OUTLINE_BTN, "w-[30px] shrink-0 justify-center px-0 text-fg-secondary")}>
            <List size={14} />
          </span>
          <span className={cn(OUTLINE_BTN, "hidden w-[30px] justify-center px-0 text-fg-secondary sm:flex")}>
            <HelpCircle size={14} />
          </span>
          <span className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-xs font-semibold text-tui-on-accent">
            <Plus size={14} />
            {t("newButton")}
          </span>
        </div>
      </div>

      <div className="flex min-h-[16.5px] shrink-0 items-center px-1">
        <Skeleton className="h-[7px] w-[180px]" />
      </div>

      {/* Phones default to the agenda, wider screens to the week grid. The
          layout is a client decision, so CSS picks the matching skeleton. */}
      <CalendarAgendaSkeleton className="sm:hidden" days={Array.from({ length: 4 }, () => ({}))} />
      <div className="hidden min-h-0 flex-1 overflow-hidden sm:flex">
        <div className="flex min-h-0 min-w-[760px] flex-1 flex-col">
          <CalendarTimeGridSkeleton
            columns={weekdays.map((weekday) => ({ weekday }))}
            allDayLabel={t("allDay")}
          />
        </div>
      </div>

      {/* Floats over the grid's foot rather than taking a row of its own, so
          the grid keeps the height it will have once loaded. */}
      <SkeletonSlow
        what="calendar"
        className="absolute right-6 bottom-7 left-6 rounded-lg border border-border-light bg-bg-elevated px-3 pb-2.5 sm:right-8 sm:left-8 md:right-10 md:left-10"
      />
    </div>
  );
}
