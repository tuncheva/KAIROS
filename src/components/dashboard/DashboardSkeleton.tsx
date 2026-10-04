"use client";

import { useLocale, useTranslations } from "next-intl";

import {
  Skeleton,
  SkeletonStatus,
  skeletonWidth,
} from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";

/**
 * The dashboard before its data lands — the route `loading.tsx` and the
 * client-side boot both render this.
 *
 * Same grid, cards, paddings and row heights as `DashboardClient`'s loaded
 * state. What the page already knows renders for real: the date eyebrow, the
 * greeting, every card title, stat label, column header and legend. Only the
 * numbers, findings, project rows, activity and team turn to hatch.
 */

/** Mirrors `CARD` in `DashboardClient`. */
const CARD =
  "overflow-hidden rounded-lg border border-tui-ink/12 bg-tui-pane shadow-[var(--tui-pane-shadow)]";

/** Mirrors `TABLE_GRID` in `DashboardClient`. */
const TABLE_GRID =
  "grid grid-cols-[minmax(0,1fr)_90px_50px_64px_minmax(0,190px)_52px_110px] items-center gap-4";

/** A control drawn as its outline — inert, only its value hatches. */
const OUTLINE = "border border-tui-ink/16 rounded-full";

function CardHeadSkeleton({
  title,
  metaWidth,
  actionLabel,
  row = 0,
}: {
  title: string;
  metaWidth?: number;
  actionLabel?: string;
  row?: number;
}) {
  return (
    <div className="border-tui-ink/8 flex items-baseline gap-3 border-b px-7 pt-5 pb-4">
      <h2 className="font-display text-tui-ink m-0 text-[22px] leading-none">
        {title}
      </h2>
      {metaWidth ? (
        <Skeleton className="h-[8px] self-center" row={row} style={{ width: metaWidth }} />
      ) : null}
      <span className="flex-1" />
      {actionLabel ? (
        <span aria-hidden="true" className="text-tui-ink2 text-[13px]">
          {actionLabel} →
        </span>
      ) : null}
    </div>
  );
}

/**
 * The radar's three findings, hatched. Exported so `RadarFindings` shows the
 * same body while its own query is still in flight.
 */
export function RadarFindingsSkeletonBody({ row = 0 }: { row?: number }) {
  const t = useTranslations("dashboard");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`flex flex-col gap-3 px-7 py-6 ${
            i > 0 ? "border-tui-ink/8 border-t md:border-t-0 md:border-l" : ""
          }`}
        >
          {/* severity · project */}
          <div className="flex h-[19px] items-center gap-2">
            <Skeleton className="h-1.5 w-1.5" shape="circle" row={row} />
            <Skeleton className="h-[8px] w-[46px]" row={row} />
            <span className="flex-1" />
            <Skeleton
              className="h-[8px]"
              row={row}
              style={{ width: skeletonWidth(i + 3, 28, 44) }}
            />
          </div>
          {/* title — two lines of 21px display */}
          <div className="flex flex-col justify-around" style={{ height: 52 }}>
            <Skeleton className="h-[14px] w-[92%]" shape="title" row={row + 1} />
            <Skeleton
              className="h-[14px]"
              shape="title"
              row={row + 1}
              style={{ width: skeletonWidth(i + 11, 40, 62) }}
            />
          </div>
          {/* detail — two lines of 14px body */}
          <div className="flex flex-col justify-around" style={{ height: 45 }}>
            <Skeleton className="h-[9px] w-full" row={row + 2} />
            <Skeleton
              className="h-[9px]"
              row={row + 2}
              style={{ width: skeletonWidth(i + 21, 48, 72) }}
            />
          </div>
          {/* the fix pill and dismiss */}
          <div className="mt-1.5 flex items-center gap-4 text-[13px]">
            <span className={`${OUTLINE} flex h-[34px] items-center px-3.5`}>
              <Skeleton
                className="h-[8px]"
                row={row + 3}
                style={{ width: i === 0 ? 96 : 74 }}
              />
            </span>
            <span className="text-tui-ink3">{t("radar.dismiss")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TodayStatSkeleton({
  label,
  noteWidth,
  row,
}: {
  label: string;
  noteWidth?: number;
  row: number;
}) {
  return (
    <div className="flex h-[26px] items-center gap-2.5 text-[14px]">
      <span className="text-tui-ink2">{label}</span>
      <span className="border-tui-ink/16 flex-1 translate-y-[4px] border-b border-dotted" />
      {noteWidth ? (
        <Skeleton className="h-[8px]" row={row} style={{ width: noteWidth }} />
      ) : null}
      <span className="flex min-w-[34px] justify-end">
        <Skeleton className="h-[20px] w-[24px]" shape="title" row={row} />
      </span>
    </div>
  );
}

function RingLegendSkeleton({
  dot,
  label,
  row,
}: {
  dot: string;
  label: string;
  row: number;
}) {
  return (
    <div className="flex h-[28px] items-center gap-2.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="text-tui-ink2">{label}</span>
      <span className="border-tui-ink/16 flex-1 translate-y-[4px] border-b border-dotted" />
      <Skeleton className="h-[14px] w-[22px]" shape="title" row={row} />
    </div>
  );
}

export function DashboardSkeleton({
  userName,
  onRetry,
}: {
  /** Known on the client boot; the route fallback has no session yet. */
  userName?: string | null;
  onRetry?: () => void;
}) {
  const t = useTranslations("dashboard");
  const tSkel = useTranslations("skeleton");
  const locale = useLocale();

  const now = new Date();
  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const hour = now.getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName =
    userName === undefined
      ? undefined
      : ((userName ?? "").trim().split(" ")[0] ?? "");

  return (
    <div className="tui-screen text-tui-ink min-h-full">
      <SkeletonStatus label={tSkel("status")} />
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 pt-10 pb-12 sm:px-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Hero — the date and greeting are real, the summary is data. */}
        <div className={`${CARD} xl:order-1`}>
          <div className="flex flex-col gap-4 px-8 py-9 sm:px-10">
            <span
              className="text-tui-ink3 text-[11px] font-medium tracking-[0.18em] uppercase"
              suppressHydrationWarning
            >
              {dateLine}
            </span>
            <h1
              className="font-display m-0 text-[40px] leading-[1.02] font-light tracking-[-0.02em] sm:text-[58px]"
              suppressHydrationWarning
            >
              {t(`greetingPlain.${greeting}`)}
              {firstName === undefined ? (
                <>
                  ,{" "}
                  <Skeleton
                    className="h-[0.62em] w-[3.2em] align-baseline"
                    shape="title"
                    tone="yours"
                    style={{ display: "inline-block" }}
                  />
                </>
              ) : firstName ? (
                <>
                  ,{" "}
                  <span className="text-tui-accent italic">{firstName}.</span>
                </>
              ) : null}
            </h1>
            <div className="flex h-[25.6px] max-w-[640px] items-center">
              <Skeleton className="h-[10px] w-[86%]" row={1} />
            </div>
          </div>
        </div>

        {/* Today — the four stat labels are real, the counts hatch. */}
        <div className={`${CARD} xl:order-2`}>
          <div className="flex flex-col gap-3.5 px-7 py-6">
            <span className="font-display text-[21px] capitalize">
              {t("tui.today")}
            </span>
            <TodayStatSkeleton label={t("stats.dueToday")} row={1} />
            <TodayStatSkeleton label={t("stats.overdue")} noteWidth={52} row={2} />
            <TodayStatSkeleton label={t("stats.openThisWeek")} noteWidth={64} row={3} />
            <TodayStatSkeleton label={t("stats.completed")} noteWidth={40} row={4} />
          </div>
        </div>

        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-6 xl:order-3">
          <section className={CARD}>
            <CardHeadSkeleton title={t("radar.title")} metaWidth={64} row={2} />
            <RadarFindingsSkeletonBody row={3} />
          </section>

          <section className={CARD}>
            <CardHeadSkeleton
              title={t("projectStatus.title")}
              metaWidth={48}
              actionLabel={t("projectStatus.action")}
              row={6}
            />
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div
                  className={`${TABLE_GRID} border-tui-ink/8 text-tui-ink3 border-b px-7 py-3 text-[11px] font-medium tracking-[0.14em] uppercase`}
                >
                  <span>{t("projectStatus.columns.project")}</span>
                  <span>{t("projectStatus.columns.team")}</span>
                  <span className="text-right">{t("projectStatus.columns.open")}</span>
                  <span className="text-right">
                    {t("projectStatus.columns.overdue")}
                  </span>
                  <span>{t("projectStatus.columns.completion")}</span>
                  <span className="text-right">%</span>
                  <span className="text-right">
                    {t("projectStatus.columns.health")}
                  </span>
                </div>
                {[0, 1, 2, 3].map((i) => {
                  const row = 7 + i;
                  const owners = (i % 3) + 1;
                  return (
                    <div
                      key={i}
                      className={`${TABLE_GRID} border-tui-ink/8 border-b px-7 py-4 text-[14px] last:border-b-0`}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex h-[28.5px] items-center">
                          <Skeleton
                            className="h-[13px]"
                            shape="title"
                            row={row}
                            style={{ width: skeletonWidth(i + 31, 42, 74) }}
                          />
                        </span>
                        <span className="flex h-[18.75px] items-center">
                          <Skeleton className="h-[8px] w-[64px]" row={row} />
                        </span>
                      </span>
                      <span className="flex">
                        {Array.from({ length: owners }, (_, j) => (
                          <span key={j} className="-mr-1.5">
                            <Skeleton
                              className="border-tui-pane h-[26px] w-[26px] border-2"
                              shape="circle"
                              row={row}
                            />
                          </span>
                        ))}
                      </span>
                      <span className="flex justify-end">
                        <Skeleton className="h-[9px] w-[14px]" row={row} />
                      </span>
                      <span className="flex justify-end">
                        <Skeleton className="h-[9px] w-[10px]" row={row} />
                      </span>
                      <Skeleton className="h-[3px] w-full" row={row} />
                      <span className="flex justify-end">
                        <Skeleton className="h-[9px] w-[28px]" row={row} />
                      </span>
                      <span className="flex items-center justify-end gap-2">
                        <Skeleton className="h-1.5 w-1.5" shape="circle" row={row} />
                        <Skeleton className="h-[8px] w-[54px]" row={row} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <SkeletonSlow what="projects" onRetry={onRetry} className="px-7 pb-4" />
          </section>

          <section className={CARD}>
            <CardHeadSkeleton
              title={t("activity.title")}
              actionLabel={t("activity.action")}
            />
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="border-tui-ink/8 grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-4 border-b px-7 py-3.5 last:border-b-0"
              >
                <Skeleton className="h-[30px] w-[30px]" shape="circle" row={8 + i} />
                <span className="flex h-[21.75px] items-center">
                  <Skeleton
                    className="h-[9px]"
                    row={8 + i}
                    style={{ width: skeletonWidth(i + 41, 48, 82) }}
                  />
                </span>
                <Skeleton className="h-[8px] w-[24px]" row={8 + i} />
              </div>
            ))}
          </section>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6 xl:order-4">
          <section className={CARD}>
            <div className="flex flex-col gap-[18px] px-7 pt-6 pb-6">
              <div className="flex items-baseline">
                <span className="font-display text-[21px]">
                  {t("workspace.title")}
                </span>
                <span className="flex-1" />
                <Skeleton className="h-[8px] w-[44px] self-center" row={1} />
              </div>

              {/* The ring: a hatched annulus where the 120 segments will be. */}
              <div className="relative mx-auto flex h-[240px] w-[240px] items-center justify-center">
                <Skeleton
                  className="h-[228px] w-[228px] items-center justify-center"
                  shape="circle"
                  row={2}
                  style={{ display: "flex" }}
                >
                  <span className="bg-tui-pane block h-[204px] w-[204px] rounded-full" />
                </Skeleton>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <Skeleton className="h-[44px] w-[84px]" shape="title" row={3} />
                  <span className="text-tui-ink3 text-[12.5px]">
                    {t("workspace.ofTasksDone")}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 text-[14px]">
                <RingLegendSkeleton dot="bg-tui-accent" label={t("workspace.doneLabel")} row={4} />
                <RingLegendSkeleton dot="bg-tui-warn" label={t("workspace.activeLabel")} row={5} />
                <RingLegendSkeleton dot="bg-tui-ink/25" label={t("workspace.todoLabel")} row={6} />
                <RingLegendSkeleton dot="bg-tui-day" label={t("workspace.dayGoneLabel")} row={7} />
              </div>
            </div>
          </section>

          <section className={CARD}>
            <div className="flex flex-col gap-4 px-7 py-6">
              <div className="flex items-baseline">
                <span className="font-display text-[21px]">
                  {t("momentum.title")}
                </span>
                <span className="flex-1" />
                <Skeleton className="h-[8px] w-[30px] self-center" row={8} />
              </div>
              <span className="flex h-[34px] items-center">
                <Skeleton className="h-[26px] w-[58%]" shape="title" row={8} />
              </span>
              <div className="flex h-16 items-end gap-[7px]" aria-hidden>
                {Array.from({ length: 14 }, (_, i) => (
                  <Skeleton
                    key={i}
                    className="min-w-0 flex-1"
                    shape="line"
                    row={9}
                    style={{ height: skeletonWidth(i + 51, 12, 100) }}
                  />
                ))}
              </div>
              <div className="text-tui-ink3 flex items-center justify-between text-[12px]">
                <Skeleton className="h-[8px] w-[36px]" row={10} />
                <span className="capitalize">{t("tui.today")}</span>
              </div>
              <span className="flex h-[21.6px] items-center">
                <Skeleton className="h-[9px] w-[78%]" row={10} />
              </span>
            </div>
          </section>

          <section className={CARD}>
            <div className="px-7 pt-6 pb-3">
              <span className="font-display text-[21px]">{t("teamToday.title")}</span>
              <div className="mt-2 flex flex-col">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="border-tui-ink/8 grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t py-[11px] first:border-t-0"
                  >
                    <Skeleton className="h-8 w-8" shape="circle" row={11 + i} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex h-[21px] items-center">
                        <Skeleton
                          className="h-[9px]"
                          row={11 + i}
                          style={{ width: skeletonWidth(i + 61, 40, 66) }}
                        />
                      </span>
                      <span className="flex h-[18.75px] items-center">
                        <Skeleton className="h-[7px] w-[72px]" row={11 + i} />
                      </span>
                    </span>
                    <Skeleton className="h-[9px] w-[42px]" row={11 + i} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
