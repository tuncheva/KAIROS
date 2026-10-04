"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "~/components/ui/icons";
import { Skeleton, SkeletonStatus, skeletonWidth } from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";
import { cn } from "~/lib/utils";
import { HeatLegend } from "./ProgressGrid";
import { STAMP, SectionHead } from "./ProgressPanels";
import { RECORD_WEEKS, WINDOW_KEYS } from "./progressModel";

/* ------------------------------------------------------------------ */
/*  Progress skeletons                                                */
/*                                                                    */
/*  Labels, section heads, tabs and the weekday gutter are known      */
/*  before the record is, so they render for real; numbers, cells,    */
/*  bars and rows hatch. Geometry is copied from ProgressPanels and   */
/*  ProgressGrid so nothing moves when the record lands.              */
/* ------------------------------------------------------------------ */

const HAIR = "border-tui-ink/[0.06]";
const NUMERALS = ["i.", "ii.", "iii."];

const WINDOW_LABEL_KEYS = {
  week: "windowWeek",
  month: "windowMonth",
  all: "windowAll",
} as const;

/** The sheet the page sits on: one quiet surface over the dashboard's hatch. */
export function Sheet({ children }: { children: ReactNode }) {
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

/** The contribution grid, every cell hatched; the wave runs across the weeks. */
export function ProgressGridSkeleton({
  weeks = RECORD_WEEKS,
  size = "lg",
  weekdayLabels,
  hint,
}: {
  weeks?: number;
  size?: "lg" | "sm";
  /** Mon/Wed/Fri gutter, as on the page. */
  weekdayLabels?: { monday: string; wednesday: string; friday: string };
  /** The caption under an interactive grid. */
  hint?: string;
}) {
  const cell = size === "lg" ? 16 : 13;
  const gap = size === "lg" ? 4 : 3;
  const gutter = weekdayLabels ? 30 : 0;
  const rowNames = weekdayLabels
    ? [weekdayLabels.monday, "", weekdayLabels.wednesday, "", weekdayLabels.friday, "", ""]
    : [];
  const waveRow = (w: number) => Math.round((w * 12) / Math.max(1, weeks - 1));

  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="-m-1 overflow-x-hidden p-1">
        <div className="flex w-max flex-col gap-2.5">
          {/* Month ticks depend on the date — hatched, roughly a month apart. */}
          <div className="flex h-[15.75px] items-center" style={{ gap, paddingLeft: gutter ? gutter + gap : 0 }}>
            {Array.from({ length: weeks }, (_, w) => (
              <span key={w} className="block" style={{ width: cell }}>
                {w % 4 === 1 && <Skeleton row={waveRow(w)} className="h-[7px] w-[18px]" />}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap }}>
            {gutter > 0 && (
              <div className="flex shrink-0 flex-col" style={{ width: gutter, gap }}>
                {Array.from({ length: 7 }, (_, r) => (
                  <span key={r} className="text-tui-ink3 flex items-center text-[10px]" style={{ height: cell }}>
                    {rowNames[r] ?? ""}
                  </span>
                ))}
              </div>
            )}
            {Array.from({ length: weeks }, (_, w) => (
              <div key={w} className="flex flex-col" style={{ gap }}>
                {Array.from({ length: 7 }, (_, r) => (
                  <Skeleton key={r} row={waveRow(w)} style={{ width: cell, height: cell }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {hint && <span className="text-tui-ink3 text-[12px] tabular-nums">{hint}</span>}
    </div>
  );
}

/** Four numbers along one rule — labels real, values and notes hatched. */
export function StatRowSkeleton({ labels, row = 0 }: { labels: string[]; row?: number }) {
  return (
    <div className="border-tui-ink/10 grid grid-cols-2 border-y lg:grid-cols-4" aria-hidden="true">
      {labels.map((label, index) => (
        <div
          key={label}
          className={cn(
            "border-tui-ink/10 flex flex-col gap-2 py-4 pr-5",
            index % 2 === 1 && "border-l pl-5 lg:pl-6",
            index === 2 && "border-t pl-0 lg:border-t-0 lg:border-l lg:pl-6",
            index === 3 && "border-t lg:border-t-0",
          )}
        >
          <span className={STAMP}>{label}</span>
          <span className="flex h-[34px] items-center sm:h-[42px]">
            <Skeleton shape="title" row={row} className="h-[26px] w-[64px] sm:h-[32px]" />
          </span>
          <span className="flex h-[18.75px] items-center">
            <Skeleton row={row} className="h-[8px]" style={{ width: skeletonWidth(index + 1, 40, 70) }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The finished log: day stamps and rows hatched. */
export function FinishedLogSkeleton({
  groups = [3, 2],
  compact = false,
  row = 0,
}: {
  groups?: number[];
  compact?: boolean;
  row?: number;
}) {
  let r = row;
  return (
    <div className="flex flex-col" aria-hidden="true">
      {groups.map((count, g) => (
        <div key={g} className="flex flex-col">
          <span className={cn("flex h-[15px] items-center", compact ? "mt-3 mb-1.5" : "mt-4 mb-2")}>
            <Skeleton row={r++} className="h-[7px] w-[84px]" />
          </span>
          {Array.from({ length: count }, (_, i) => {
            const rowIndex = r++;
            return (
              <div
                key={i}
                className={cn(
                  "grid h-[38px] items-center gap-3 border-t py-2 sm:gap-[18px]",
                  HAIR,
                  compact
                    ? "grid-cols-[minmax(0,1fr)_44px]"
                    : "grid-cols-[minmax(0,1fr)_96px_40px] sm:grid-cols-[minmax(0,1fr)_170px_44px]",
                )}
              >
                <Skeleton
                  row={rowIndex}
                  className="h-[9px]"
                  style={{ width: skeletonWidth(g * 5 + i + 1, 45, 85) }}
                />
                {!compact && (
                  <span className="flex min-w-0 items-center gap-[9px]">
                    <Skeleton shape="circle" row={rowIndex} className="h-1.5 w-1.5" />
                    <Skeleton
                      row={rowIndex}
                      className="h-[8px]"
                      style={{ width: skeletonWidth(g * 5 + i + 7, 40, 80) }}
                    />
                  </span>
                )}
                <Skeleton row={rowIndex} className="ml-auto h-[7px] w-[26px]" />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Remaining workload: dot, name, dotted leader, number. */
export function WorkloadSkeleton({ count = 3, row = 0 }: { count?: number; row?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-[22px] items-center gap-2.5">
          <Skeleton shape="circle" row={row + i} className="h-1.5 w-1.5" />
          <Skeleton row={row + i} className="h-[9px]" style={{ width: skeletonWidth(i + 11, 22, 40) }} />
          <span className="border-tui-ink/20 min-w-4 flex-1 border-b border-dotted" />
          <Skeleton shape="title" row={row + i} className="h-[16px] w-[20px]" />
        </div>
      ))}
    </div>
  );
}

/**
 * The whole record while it loads — before the browser clock is known, as the
 * route's loading state, and while `getRecord` is in flight.
 */
export function ProgressSkeleton() {
  const t = useTranslations("progress.record");
  const ts = useTranslations("skeleton");

  return (
    <Sheet>
      <SkeletonStatus label={ts("status")} />

      {/* Toolbar: the window tabs, inert, on their default. */}
      <header className="flex flex-wrap items-center gap-x-7 gap-y-2" aria-hidden="true">
        <div className="flex items-center gap-[22px]">
          {WINDOW_KEYS.map((key) => (
            <span
              key={key}
              className={cn(
                "flex h-9 items-center border-b-[1.5px] text-[13px] font-semibold",
                key === "month" ? "border-tui-accent text-tui-ink" : "text-tui-ink3 border-transparent",
              )}
            >
              {t(WINDOW_LABEL_KEYS[key])}
            </span>
          ))}
        </div>
      </header>

      {/* Headline — the eyebrow is a label, the sentence is the data. */}
      <section className="mt-7 flex flex-col sm:mt-10">
        <span className="text-tui-accent font-mono text-[11px] tracking-[0.22em] uppercase">{t("eyebrow")}</span>
        <span className="mt-3.5 flex h-[34px] items-center sm:h-[46px] lg:h-[56px]">
          <Skeleton shape="title" row={0} className="h-[28px] w-[min(560px,80%)] sm:h-[34px] lg:h-[40px]" />
        </span>
        <span className="mt-3 flex h-6 items-center">
          <Skeleton row={1} className="h-[9px] w-[min(380px,70%)]" />
        </span>
      </section>

      <div className="mt-8">
        <StatRowSkeleton
          row={2}
          labels={[t("statFinished"), t("statPerDay"), t("statStreak"), t("statBestDay")]}
        />
      </div>

      <section className="mt-11">
        <SectionHead title={t("gridTitle")} meta={t("gridSubtitle", { weeks: RECORD_WEEKS })}>
          <HeatLegend less={t("less")} more={t("more")} />
        </SectionHead>

        <div className="flex flex-col lg:flex-row">
          <div className="pt-5 lg:pr-8">
            <ProgressGridSkeleton
              weekdayLabels={{ monday: t("weekdayMon"), wednesday: t("weekdayWed"), friday: t("weekdayFri") }}
              hint={t("gridHint")}
            />
          </div>

          <div
            className="border-tui-ink/[0.08] mt-6 flex min-w-0 flex-1 flex-col border-t pt-5 lg:mt-0 lg:border-t-0 lg:border-l lg:pl-8"
            aria-hidden="true"
          >
            <span className={STAMP}>{t("selectedDay")}</span>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex h-[27px] items-center">
                <Skeleton shape="title" row={4} className="h-[18px] w-[200px]" />
              </span>
              <Skeleton row={4} className="h-[8px] w-[64px]" />
            </div>
            <div className="mt-3 flex flex-col">
              {[0, 1, 2].map((i) => (
                <div key={i} className="border-tui-ink/[0.07] flex h-[38px] items-center gap-3 border-t py-2">
                  <Skeleton shape="circle" row={5 + i} className="h-1.5 w-1.5" />
                  <Skeleton row={5 + i} className="h-[9px]" style={{ width: skeletonWidth(i + 21, 35, 65) }} />
                  <span className="flex-1" />
                  <Skeleton row={5 + i} className="h-[8px] w-[72px]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-11 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <section>
          <div className="border-tui-ink/10 flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b pb-3">
            <h2 className="font-display text-tui-ink m-0 text-[22px] leading-none font-normal">{t("logRecent")}</h2>
            <Skeleton row={6} className="h-[8px] w-[60px]" />
          </div>
          <FinishedLogSkeleton row={7} />
        </section>

        <div className="flex flex-col gap-10">
          {/* The coach: section head real, the suggestions hatched. */}
          <section aria-hidden="true">
            <SectionHead title={t("suggestions")} />
            {NUMERALS.map((numeral, i) => (
              <div key={numeral} className={cn("flex gap-3.5 border-b py-3.5", HAIR)}>
                <span className="font-display text-tui-ink3 pt-px text-[18px] leading-[1.1] italic">{numeral}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex h-[21px] items-center">
                    <Skeleton row={7 + i} className="h-[9px]" style={{ width: skeletonWidth(i + 31, 60, 90) }} />
                  </span>
                  <span className="flex h-[21.6px] items-center">
                    <Skeleton row={7 + i} className="h-[8px]" style={{ width: skeletonWidth(i + 41, 35, 60) }} />
                  </span>
                </div>
                <span className="border-tui-ink/10 text-tui-ink3 grid h-8 w-8 shrink-0 place-items-center rounded-full border">
                  <X size={10} />
                </span>
              </div>
            ))}
          </section>
          <section>
            <SectionHead title={t("workloadTitle")} />
            <div className="pt-4">
              <WorkloadSkeleton row={10} />
            </div>
          </section>
        </div>
      </div>

      <div className="mt-11">
        <StandingsSkeleton />
      </div>

      <SkeletonSlow what="progress" className="mt-10" />
    </Sheet>
  );
}

/** The leaderboard — your own row in the accent hatch. */
export function StandingsSkeleton({ rows = 5, selfIndex = 1 }: { rows?: number; selfIndex?: number }) {
  const t = useTranslations("progress.record");

  return (
    <section aria-hidden="true">
      <SectionHead title={t("boardTitle")} meta={t("boardSubtitle")} />
      {Array.from({ length: rows }, (_, i) => {
        const self = i === selfIndex;
        const tone = self ? ("yours" as const) : undefined;
        const row = 8 + i;
        return (
          <div
            key={i}
            className={cn(
              "grid w-full grid-cols-[32px_30px_minmax(0,1fr)_64px] items-center gap-3.5 border-b py-2 sm:grid-cols-[44px_34px_240px_minmax(0,1fr)_76px] sm:gap-[18px]",
              HAIR,
            )}
          >
            <span className="font-display text-tui-ink3 text-[19px] leading-none italic tabular-nums">{i + 1}</span>
            <Skeleton shape="circle" tone={tone} row={row} className="h-[30px] w-[30px]" />
            <span className="flex min-w-0 items-center gap-2.5">
              <Skeleton tone={tone} row={row} className="h-[9px]" style={{ width: skeletonWidth(i + 51, 45, 80) }} />
              {self && (
                <span className="text-tui-accent font-mono text-[9.5px] tracking-[0.2em] uppercase">
                  {t("profileYou")}
                </span>
              )}
            </span>
            <span className="hidden sm:block">
              <Skeleton tone={tone} row={row} className="h-0.5" style={{ width: skeletonWidth(i + 61, 20, 90) }} />
            </span>
            <span className="flex h-6 items-center justify-end">
              <Skeleton shape="title" tone={tone} row={row} className="h-[18px] w-[28px]" />
            </span>
          </div>
        );
      })}
    </section>
  );
}

const TABLE_COLUMNS = "grid-cols-[250px_minmax(210px,1fr)_84px_76px_76px_64px_118px] gap-5";

/** The team table while `getTeam` loads — column heads real, rows hatched. */
export function TeamTableSkeleton({ rows = 5 }: { rows?: number }) {
  const t = useTranslations("progress.record");

  return (
    <section aria-hidden="true">
      <div className="border-tui-ink/10 flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b pb-3">
        <h2 className="font-display text-tui-ink m-0 text-[22px] leading-none font-normal">{t("membersTitle")}</h2>
        <Skeleton className="h-[8px] w-[72px]" />
      </div>
      <div className="overflow-x-hidden">
        <div className="min-w-[960px]">
          <div className={cn("grid pt-3 pb-2", TABLE_COLUMNS, STAMP)}>
            <span>{t("colMember")}</span>
            <span>{t("colLast30")}</span>
            <span className="text-right">{t("colFinished")}</span>
            <span className="text-right">{t("colPerDay")}</span>
            <span className="text-right">{t("colStreak")}</span>
            <span className="text-right">{t("colOpen")}</span>
            <span className="text-right">{t("colLastFinished")}</span>
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className={cn("border-tui-ink/[0.07] grid items-center border-t py-2", TABLE_COLUMNS)}>
              <span className="flex min-w-0 items-center gap-3.5">
                <Skeleton shape="circle" row={i + 1} className="h-[34px] w-[34px]" />
                <span className="flex min-w-0 flex-1 flex-col gap-[9px]">
                  <Skeleton row={i + 1} className="h-[9px]" style={{ width: skeletonWidth(i + 71, 50, 85) }} />
                  <Skeleton row={i + 1} className="h-[7px] w-[56px]" />
                </span>
              </span>
              <span className="flex h-5 items-end gap-[3px]">
                {Array.from({ length: 30 }, (_, d) => (
                  <Skeleton
                    key={d}
                    row={i + 1}
                    className="w-1 rounded-[1px]"
                    style={{ height: 4 + Math.round(((Math.sin((i + 1) * 7 + d * 1.7) + 1) / 2) * 14) }}
                  />
                ))}
              </span>
              {[28, 24, 34, 18, 52].map((w, c) => (
                <span key={c} className="flex justify-end">
                  <Skeleton shape={c === 0 ? "title" : "line"} row={i + 1} className={c === 0 ? "h-[16px]" : "h-[9px]"} style={{ width: w }} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The member drawer's body while that person's record loads. */
export function MemberDrawerSkeleton() {
  const t = useTranslations("progress.record");
  const labels = [t("statFinished"), t("statStreak"), t("colOpen"), t("statBestDay")];

  return (
    <div className="flex flex-col" aria-hidden="true">
      <div className="border-tui-ink/10 mt-8 grid grid-cols-2 border-t">
        {labels.map((label, index) => (
          <div
            key={label}
            className={cn("border-tui-ink/10 flex flex-col gap-2 border-b py-5", index % 2 === 1 && "border-l pl-5")}
          >
            <span className={cn(STAMP, "text-[9.5px]")}>{label}</span>
            <span className="flex h-10 items-center">
              <Skeleton shape="title" row={Math.floor(index / 2)} className="h-[30px] w-[56px]" />
            </span>
          </div>
        ))}
      </div>

      <span className={cn(STAMP, "mt-8 text-[9.5px]")}>{t("drawerWeeks", { weeks: RECORD_WEEKS })}</span>
      <div className="mt-3">
        <ProgressGridSkeleton size="sm" />
      </div>

      <span className={cn(STAMP, "mt-8 mb-3.5 text-[9.5px]")}>{t("drawerStillOn")}</span>
      <WorkloadSkeleton row={6} />

      <span className={cn(STAMP, "mt-8 text-[9.5px]")}>{t("logRecent")}</span>
      <FinishedLogSkeleton groups={[2, 2]} compact row={8} />
    </div>
  );
}
