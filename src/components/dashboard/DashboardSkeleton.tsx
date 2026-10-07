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
 * Same frame, cards, paddings and row heights as `DashboardClient`'s loaded
 * state. What the page already knows renders for real: the date eyebrow, the
 * greeting, every card title and figure label, the weekday letters. Only the
 * numbers, tasks, findings, projects, team and activity turn to hatch.
 */

/** Mirrors `CARD` in `DashboardClient`. */
const CARD =
  "overflow-hidden rounded-[14px] border border-tui-ink/10 bg-tui-pane shadow-[var(--tui-pane-shadow)]";

/** Mirrors `PAD` in `DashboardClient`. */
const PAD = "px-[18px] sm:px-7";

/** Mirrors `EYEBROW` in `DashboardClient`. */
const EYEBROW =
  "text-tui-ink3 text-[10.5px] font-medium tracking-[0.18em] uppercase";

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
    <>
      <div className={`flex items-baseline gap-3 ${PAD} pt-[22px] pb-4`}>
        <h2 className="font-display text-tui-ink m-0 text-[24px] leading-none tracking-[-0.005em]">
          {title}
        </h2>
        {metaWidth ? (
          <Skeleton
            className="hidden h-[8px] self-center sm:block"
            row={row}
            style={{ width: metaWidth }}
          />
        ) : null}
        <span className="flex-1" />
        {actionLabel ? (
          <span aria-hidden="true" className="text-tui-ink3 text-[12.5px]">
            {actionLabel} →
          </span>
        ) : null}
      </div>
      <div className="bg-tui-ink/8 mx-[18px] h-px sm:mx-7" />
    </>
  );
}

/**
 * The radar's findings as hatched rows. Exported so `RadarFindings` shows the
 * same body while its own query is still in flight.
 */
export function RadarFindingsSkeletonBody({ row = 0 }: { row?: number }) {
  const t = useTranslations("dashboard");

  return (
    <div className="py-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`border-tui-ink/6 grid grid-cols-1 items-center gap-3 border-t py-[18px] first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 ${PAD}`}
        >
          <div className="flex min-w-0 flex-col">
            {/* severity · project */}
            <div className="flex h-[16px] items-center gap-2">
              <Skeleton className="h-1.5 w-1.5" shape="circle" row={row + i} />
              <Skeleton className="h-[7px] w-[52px]" row={row + i} />
              <Skeleton
                className="h-[7px]"
                row={row + i}
                style={{ width: skeletonWidth(i + 3, 40, 70) }}
              />
            </div>
            {/* title */}
            <div className="mt-1.5 mb-1 flex h-[20px] items-center">
              <Skeleton
                className="h-[10px]"
                row={row + i}
                style={{ width: skeletonWidth(i + 11, 48, 74) }}
              />
            </div>
            {/* detail */}
            <div className="flex h-[20px] items-center">
              <Skeleton
                className="h-[8px]"
                row={row + i}
                style={{ width: skeletonWidth(i + 21, 58, 86) }}
              />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="border-tui-ink/16 flex h-[30px] items-center rounded-full border px-3.5">
              <Skeleton
                className="h-[7px]"
                row={row + i}
                style={{ width: i === 0 ? 90 : 70 }}
              />
            </span>
            <span className="text-tui-ink3 px-2.5 text-[12.5px]">
              {t("radar.dismiss")}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FigureSkeleton({
  index,
  label,
  bar = false,
}: {
  index: number;
  label: string;
  bar?: boolean;
}) {
  const divider =
    index === 0
      ? ""
      : index % 2 === 1
        ? "border-l pl-5 sm:pl-7 lg:px-7"
        : "pr-5 lg:border-l lg:px-7";

  return (
    <div className={`border-tui-ink/10 flex min-w-0 flex-col gap-2 ${divider}`}>
      <span className={EYEBROW}>{label}</span>
      <span className="flex h-[37.8px] items-end sm:h-[46.8px]">
        <Skeleton className="h-[30px] w-[46px] sm:h-[38px]" shape="title" row={2} />
      </span>
      {bar && <span className="bg-tui-ink/8 mt-1 h-[2px] max-w-[200px] rounded-full" />}
      <span className="flex h-[18.75px] items-center">
        <Skeleton
          className="h-[7px]"
          row={2}
          style={{ width: [96, 84, 112, 128][index] }}
        />
      </span>
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

  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="text-tui-ink min-h-full">
      <SkeletonStatus label={tSkel("status")} />
      <div className="mx-auto max-w-[1240px] px-4 pt-8 pb-16 sm:px-8 sm:pt-14 lg:px-12 lg:pb-24">
        {/* Headline — the date and greeting are real, the brief is data. */}
        <section className="border-tui-ink/10 grid grid-cols-1 items-end gap-6 border-b pb-7 sm:pb-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12">
          <div className="min-w-0">
            <span className={EYEBROW} suppressHydrationWarning>
              {dateLine}
            </span>
            <h1
              className="font-display mt-3.5 mb-5 text-[44px] leading-[0.98] font-normal tracking-[-0.025em] sm:text-[60px] lg:text-[72px]"
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
                  , <em className="text-tui-accent">{firstName}.</em>
                </>
              ) : null}
            </h1>
            <div className="flex max-w-[620px] flex-col gap-[14px] py-[7px]">
              <Skeleton className="h-[10px] w-[94%]" row={1} />
              <Skeleton className="h-[10px] w-[62%]" row={1} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 lg:flex-col lg:items-end" aria-hidden="true">
            <span className="border-tui-ink/14 text-tui-ink3 flex h-[34px] items-center rounded-full border px-3.5 text-[13px]">
              {t("brief.ask")}
            </span>
            <span className="border-tui-ink/14 text-tui-ink3 flex h-[34px] items-center rounded-full border px-3.5 text-[13px]">
              {t("brief.planWeek")}
            </span>
          </div>
        </section>

        {/* Figures — the labels are real, the numbers hatch. */}
        <section className="grid grid-cols-2 gap-y-6 pt-6 pb-9 sm:pt-7 sm:pb-14 lg:grid-cols-4">
          <FigureSkeleton index={0} label={t("stats.dueToday")} bar />
          <FigureSkeleton index={1} label={t("stats.overdue")} />
          <FigureSkeleton index={2} label={t("stats.openThisWeek")} />
          <FigureSkeleton index={3} label={t("stats.doneThisWeek")} />
        </section>

        <div className="grid grid-cols-1 items-start gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-7">
            <section className={CARD}>
              <CardHeadSkeleton title={t("nextUp.title")} metaWidth={150} row={3} />
              <div className="py-1 pb-2.5" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={`border-tui-ink/6 grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2.5 border-t py-4 first:border-t-0 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:gap-3.5 ${PAD}`}
                  >
                    <span className="font-display text-tui-ink3 text-[20px] leading-[1.2] italic">
                      {["i.", "ii.", "iii."][i]}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex h-[22.5px] items-center">
                        <Skeleton
                          className="h-[10px]"
                          row={4 + i}
                          style={{ width: skeletonWidth(i + 41, 40, 66) }}
                        />
                      </span>
                      <span className="mt-1 flex h-[18.75px] items-center">
                        <Skeleton className="h-[7px] w-[180px]" row={4 + i} />
                      </span>
                    </span>
                    <span className="border-tui-ink/20 mt-0.5 h-5 w-5 rounded-full border-[1.25px]" />
                  </div>
                ))}
              </div>
            </section>

            <section className={CARD}>
              <CardHeadSkeleton title={t("radar.title")} metaWidth={64} row={6} />
              <RadarFindingsSkeletonBody row={7} />
            </section>

            <section className={CARD}>
              <CardHeadSkeleton
                title={t("projectStatus.title")}
                metaWidth={48}
                actionLabel={t("projectStatus.action")}
                row={9}
              />
              <div className="py-1 pb-2" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={`border-tui-ink/6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-t py-4 first:border-t-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_110px] sm:gap-x-7 ${PAD}`}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex h-[21.75px] items-center">
                        <Skeleton
                          className="h-[10px]"
                          row={10 + i}
                          style={{ width: skeletonWidth(i + 51, 50, 80) }}
                        />
                      </span>
                      <span className="flex h-[18px] items-center">
                        <Skeleton className="h-[7px] w-[110px]" row={10 + i} />
                      </span>
                    </span>
                    <span className="order-3 col-span-full sm:order-none sm:col-span-1">
                      <span className="bg-tui-ink/8 block h-[3px] rounded-full" />
                      <span className="mt-2 flex h-[17px] justify-between">
                        <Skeleton className="h-[7px] w-[52px]" row={10 + i} />
                        <Skeleton className="h-[7px] w-[64px]" row={10 + i} />
                      </span>
                    </span>
                    <span className="flex justify-end">
                      <Skeleton className="h-[8px] w-[64px]" row={10 + i} />
                    </span>
                  </div>
                ))}
              </div>
              <SkeletonSlow what="projects" onRetry={onRetry} className="px-7 pb-4" />
            </section>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-7 sm:grid-cols-2 xl:grid-cols-1">
            <section className={CARD}>
              <CardHeadSkeleton title={t("week.title")} actionLabel={t("week.action")} />
              <div className="grid grid-cols-7 px-2 pt-1.5 pb-5 sm:px-5" aria-hidden="true">
                {week.map((d) => (
                  <div key={d.toISOString()} className="flex flex-col items-center gap-1.5 py-2.5">
                    <span className="text-tui-ink3 text-[10px] tracking-[0.12em] uppercase">
                      {narrow.format(d)}
                    </span>
                    <span className="font-display text-[21px] leading-none" suppressHydrationWarning>
                      {d.getDate()}
                    </span>
                    <span className="flex h-[16.5px] items-center">
                      <Skeleton className="h-[7px] w-[10px]" row={4} />
                    </span>
                    <span className="h-1.5" />
                  </div>
                ))}
              </div>
            </section>

            <section className={CARD}>
              <CardHeadSkeleton title={t("teamToday.title")} metaWidth={56} />
              <div className="pt-1.5 pb-3" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-2.5 sm:px-6"
                  >
                    <Skeleton className="h-[26px] w-[26px]" shape="circle" row={6 + i} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex h-[20px] items-center">
                        <Skeleton
                          className="h-[9px]"
                          row={6 + i}
                          style={{ width: skeletonWidth(i + 61, 40, 66) }}
                        />
                      </span>
                      <span className="flex h-[17px] items-center">
                        <Skeleton className="h-[7px] w-[72px]" row={6 + i} />
                      </span>
                    </span>
                    <Skeleton className="h-[12px] w-[58px]" row={6 + i} />
                  </div>
                ))}
              </div>
            </section>

            <section className={CARD}>
              <CardHeadSkeleton
                title={t("activity.title")}
                actionLabel={t("activity.action")}
              />
              <div className="py-1.5 pb-3.5" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[26px_minmax(0,1fr)] gap-3 px-[18px] py-[9px] sm:px-6"
                  >
                    <Skeleton className="h-[26px] w-[26px]" shape="circle" row={9 + i} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex h-[18.85px] items-center">
                        <Skeleton
                          className="h-[8px]"
                          row={9 + i}
                          style={{ width: skeletonWidth(i + 71, 60, 92) }}
                        />
                      </span>
                      <span className="flex h-[17px] items-center">
                        <Skeleton className="h-[6px] w-[40px]" row={9 + i} />
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
