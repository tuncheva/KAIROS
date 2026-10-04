/**
 * The projects list while `getMyProjects` is on its way.
 *
 * Drawn from `ProjectsWorkspace`'s list view — same cards, same controls row,
 * same table grid — so nothing moves when the rows land. The title, labels,
 * filter and sort names, and column headers are real; only the counts, the
 * caption and the rows hatch. Controls are inert outlines.
 *
 * No `"use client"`: the route's `loading.tsx` renders it on the server and the
 * workspace renders it on the client while its query settles.
 */

import { useTranslations } from "next-intl";

import { Search } from "~/components/ui/icons";
import {
  Skeleton,
  SkeletonStatus,
  skeletonWidth,
} from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";

/* Kept in step with `ProjectsWorkspace` — the card shell and the list grid. */
const CARD =
  "overflow-hidden rounded-lg border border-tui-ink/12 bg-tui-pane shadow-[var(--tui-pane-shadow)]";
const LIST_GRID =
  "grid grid-cols-[minmax(0,1fr)_220px_52px_110px_96px_110px_12px] items-center gap-5";

const FILTERS = ["all", "track", "risk", "done"] as const;
const SORTS = ["updated", "progress", "name"] as const;
const VIEWS = ["list", "grid"] as const;
const ROWS = 6;

function PillGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-tui-ink/12 bg-tui-pane flex gap-1 rounded-full border p-1 shadow-[var(--tui-pane-shadow)]">
      {children}
    </div>
  );
}

function Pill({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium ${
        active ? "bg-tui-accent/[0.14] text-tui-ink" : "text-tui-ink3"
      }`}
    >
      {children}
    </span>
  );
}

function StatLeader({ label, row }: { label: string; row: number }) {
  return (
    <div className="flex items-baseline gap-2.5 text-[14px]">
      <span className="text-tui-ink2">{label}</span>
      <span className="border-tui-ink/16 flex-1 -translate-y-1 border-b border-dotted" />
      <span className="flex h-[26px] items-center">
        <Skeleton shape="title" className="h-[20px] w-[34px]" row={row} />
      </span>
    </div>
  );
}

export function ProjectsSkeleton({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations("projects");
  const tSkeleton = useTranslations("skeleton");

  return (
    <div className="tui-screen text-tui-ink min-h-full">
      <SkeletonStatus label={tSkeleton("status")} />
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 pt-10 pb-12 sm:px-8">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className={CARD}>
            <div className="flex flex-col gap-3.5 px-8 py-9 sm:px-10">
              {/* The summary eyebrow is all counts — data. */}
              <span className="flex h-[16.5px] items-center">
                <Skeleton className="h-[8px] w-[260px] max-w-full" row={0} />
              </span>
              <h1 className="font-display m-0 text-[52px] leading-none font-light tracking-[-0.02em] sm:text-[64px]">
                {t("title")}
              </h1>
            </div>
          </div>

          <div className={CARD}>
            <div className="flex flex-col gap-3.5 px-7 py-6">
              <span className="font-display text-[21px]">
                {t("tui.workspace")}
              </span>
              <StatLeader label={t("stats.active")} row={1} />
              <StatLeader label={t("stats.tasks")} row={2} />
              <StatLeader label={t("stats.completed")} row={3} />
              <StatLeader label={t("stats.overall")} row={4} />
            </div>
          </div>
        </div>

        {/* Controls — outlines with their real names; only the counts hatch. */}
        <div aria-hidden className="flex flex-wrap items-center gap-3">
          <span className="border-tui-ink/12 bg-tui-pane flex h-10 w-full items-center gap-2.5 rounded-full border px-4 shadow-[var(--tui-pane-shadow)] sm:w-[300px]">
            <Search size={15} className="text-tui-ink3 flex-none" aria-hidden />
            <span className="text-tui-ink3 min-w-0 flex-1 truncate text-[13.5px]">
              {t("searchPlaceholder")}
            </span>
          </span>

          <PillGroup>
            {FILTERS.map((key) => (
              <Pill key={key} active={key === "all"}>
                {t(`filters.${key}`)}
                <Skeleton className="h-[8px] w-[14px]" shape="line" row={5} />
              </Pill>
            ))}
          </PillGroup>

          <span className="hidden flex-1 lg:block" />

          <span className="text-tui-ink3 text-[12.5px]">{t("sortLabel")}</span>
          <PillGroup>
            {SORTS.map((key) => (
              <Pill key={key} active={key === "updated"}>
                {t(`sorts.${key}`)}
              </Pill>
            ))}
          </PillGroup>
          <PillGroup>
            {VIEWS.map((key) => (
              <Pill key={key} active={key === "list"}>
                {t(`views.${key}`)}
              </Pill>
            ))}
          </PillGroup>
        </div>

        <section className={CARD}>
          <div className="border-tui-ink/8 flex items-baseline gap-3 border-b px-7 pt-5 pb-4">
            <h2 className="font-display m-0 text-[22px] leading-none">
              {t("title")}
            </h2>
            <Skeleton className="h-[8px] w-[150px]" row={5} />
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              <div
                className={`${LIST_GRID} border-tui-ink/8 text-tui-ink3 border-b px-7 py-3 text-[11px] font-medium tracking-[0.14em] uppercase`}
              >
                <span>{t("colProject")}</span>
                <span>{t("colProgress")}</span>
                <span className="text-right">%</span>
                <span>{t("colTeam")}</span>
                <span>{t("colUpdated")}</span>
                <span className="text-right">{t("colHealth")}</span>
                <span />
              </div>

              {Array.from({ length: ROWS }).map((_, i) => {
                const row = i + 6;
                return (
                  <div
                    key={i}
                    aria-hidden
                    className={`${LIST_GRID} border-tui-ink/8 border-b px-7 py-[18px] text-[14px] last:border-b-0`}
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex h-[30px] items-center">
                        <Skeleton
                          shape="title"
                          className="h-[14px]"
                          style={{ width: skeletonWidth(i + 1, 32, 64) }}
                          row={row}
                        />
                      </span>
                      <span className="flex h-[19.5px] items-center">
                        <Skeleton
                          className="h-[8px]"
                          style={{ width: skeletonWidth(i + 41, 40, 82) }}
                          row={row}
                        />
                      </span>
                    </span>
                    <Skeleton className="h-[3px] w-full" row={row} />
                    <span className="flex justify-end">
                      <Skeleton className="h-[9px] w-[30px]" row={row} />
                    </span>
                    <span className="flex">
                      {Array.from({ length: 1 + (i % 3) }).map((__, a) => (
                        <Skeleton
                          key={a}
                          shape="circle"
                          className="border-tui-pane -mr-1.5 h-[26px] w-[26px] border-2"
                          row={row}
                        />
                      ))}
                    </span>
                    <Skeleton
                      className="h-[8px]"
                      style={{ width: skeletonWidth(i + 71, 40, 70) }}
                      row={row}
                    />
                    <span className="flex items-center justify-end gap-2">
                      <Skeleton
                        shape="circle"
                        className="h-1.5 w-1.5"
                        row={row}
                      />
                      <Skeleton className="h-[8px] w-[60px]" row={row} />
                    </span>
                    <span className="text-tui-ink3">›</span>
                  </div>
                );
              })}
            </div>
          </div>

          <SkeletonSlow what="projects" onRetry={onRetry} className="px-7 pb-4" />
        </section>
      </div>
    </div>
  );
}
