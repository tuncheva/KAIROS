"use client";

import { useTranslations } from "next-intl";

import { KeyRound, LogOut, Plus, Search, User } from "~/components/ui/icons";
import { PERMISSION_DISPLAY_ORDER, usePermissionLabel } from "~/components/orgs/PermissionGrid";
import { Skeleton, SkeletonStatus, skeletonWidth, type SkeletonShape } from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";
import { TEMPLATE_ROLE_ORDER } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import { TEAM_EYEBROW, TEAM_PANE } from "./teamUi";

/**
 * The Team page's three panes while they load — the same panes, paddings and
 * row heights as `TeamWorkspaces`, `TeamOrg` and `TeamPerson`, with only the
 * data hatched. Titles, tabs, column headers, labels and control outlines are
 * real. Used by `/orgs/loading.tsx` and by `TeamClient` while its first
 * queries are in flight.
 */

/** An inert outline in place of a control; only its value would hatch. */
const OUTLINE = "border border-tui-ink/16 bg-transparent";

/** A text bar centred in the line box the real text would take. */
function Bar({
  box,
  bar,
  width,
  row,
  tone,
  shape = "line",
  className,
}: {
  box: string;
  bar: string;
  width: string;
  row: number;
  tone?: "yours";
  shape?: SkeletonShape;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center", box, className)} aria-hidden="true">
      <Skeleton className={bar} shape={shape} row={row} tone={tone} style={{ width }} />
    </span>
  );
}

export function TeamWorkspacesSkeleton() {
  const t = useTranslations("team");

  return (
    <aside className={cn(TEAM_PANE, "flex min-h-0 flex-col")} aria-label={t("workspaces")}>
      <div className="flex flex-col gap-2.5 px-[22px] pt-[26px] pb-[18px]">
        <Bar box="h-[16.5px]" bar="h-[7px]" width="120px" row={0} />
        <div className="flex items-baseline gap-2.5">
          <h1 className="m-0 font-display text-[46px] leading-none font-light tracking-[-0.02em]">{t("title")}</h1>
          <Skeleton className="h-[14px] w-5" shape="title" row={0} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-3 pb-3.5" aria-hidden="true">
        <span className={cn(TEAM_EYEBROW, "px-2.5 pt-1.5 pb-2")}>{t("workspaces")}</span>
        <div className="flex w-full items-center gap-3 rounded-lg p-2.5 text-tui-ink">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[9px] bg-tui-ink/5 text-tui-ink3">
            <User size={15} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14.5px] font-medium">{t("personalWorkspace")}</span>
            <span className="truncate text-[12.5px] text-tui-ink3">{t("justYou")}</span>
          </span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex w-full items-center gap-3 rounded-lg p-2.5">
            <Skeleton className="h-9 w-9" shape="tile" row={i} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Bar box="h-[21.75px]" bar="h-[9px]" width={skeletonWidth(i, 48, 78)} row={i} />
              <Bar box="h-[18.75px]" bar="h-[7px]" width={skeletonWidth(i + 7, 34, 56)} row={i} />
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-tui-ink/8 px-4 pt-3.5 pb-4" aria-hidden="true">
        <span className={cn(OUTLINE, "flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium text-tui-ink")}>
          <KeyRound size={14} className="text-tui-ink2" />
          {t("joinWithCode")}
        </span>
        <span className={cn(OUTLINE, "flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium text-tui-ink")}>
          <Plus size={14} className="text-tui-ink2" />
          {t("newOrg")}
        </span>
      </div>
    </aside>
  );
}

export function TeamOrgSkeleton({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations("team");
  const tSkel = useTranslations("skeleton");

  const tabs = [t("tabPeople"), t("tabInvites"), t("tabRoles")];
  const grid = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.5fr)_120px_minmax(0,1.3fr)_96px]";

  return (
    <main className={cn(TEAM_PANE, "flex min-h-[520px] min-w-0 flex-col")}>
      <SkeletonStatus label={tSkel("status")} />

      <div className="flex flex-wrap items-start gap-[18px] px-5 pt-[26px] sm:px-7" aria-hidden="true">
        <Skeleton className="h-14 w-14" shape="tile" row={0} style={{ borderRadius: 12 }} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Bar box="h-[16.5px]" bar="h-[7px]" width="140px" row={0} />
          <Bar box="h-10" bar="h-[28px]" shape="title" width="46%" row={0} />
          <Bar box="h-[19.5px]" bar="h-[8px]" width="120px" row={1} />
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className={cn(OUTLINE, "grid h-9 w-9 place-items-center rounded-full text-tui-ink2")}>
            <LogOut size={14} />
          </span>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto border-b border-tui-ink/8 px-5 pt-5 sm:px-7" aria-hidden="true">
        {tabs.map((text, i) => (
          <span
            key={text}
            className={cn(
              "-mb-px mr-[18px] flex h-10 items-center gap-[7px] border-b-[1.5px] px-1 text-[14px] font-medium",
              i === 0 ? "border-tui-ink text-tui-ink" : "border-transparent text-tui-ink3",
            )}
          >
            {text}
            <Skeleton className="h-[7px] w-3" row={1} />
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4 pb-3 sm:px-7" aria-hidden="true">
        <span className={cn(OUTLINE, "flex h-9 w-full items-center gap-2.5 rounded-full bg-tui-bg pr-2 pl-3.5 text-[13.5px] text-tui-ink3 sm:w-[280px]")}>
          <Search size={14} className="flex-none" />
          {t("searchPeople")}
        </span>
        <span className="hidden flex-1 sm:block" />
        <span className={cn(OUTLINE, "flex h-7 items-center gap-1.5 rounded-full px-[11px] text-[12.5px] font-medium text-tui-ink2")}>
          {t("filterAll")}
          <Skeleton className="h-[7px] w-3" row={2} />
        </span>
      </div>

      <div
        className="hidden h-[30px] grid-cols-[minmax(0,1.5fr)_120px_minmax(0,1.3fr)_96px] items-center gap-4 border-b border-tui-ink/8 px-7 text-[11px] font-medium tracking-[0.14em] text-tui-ink3 uppercase md:grid"
        aria-hidden="true"
      >
        <span>{t("colPerson")}</span>
        <span>{t("colRole")}</span>
        <span>{t("colCan")}</span>
        <span className="text-right">{t("colJoined")}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-2 pt-1.5 sm:px-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => {
          const row = i + 3;
          // The first person who isn't you starts selected (you sort first).
          const tone = i === 1 ? ("yours" as const) : undefined;
          return (
            <div
              key={i}
              className={cn(
                "grid w-full items-center gap-4 rounded-lg px-3 py-2.5",
                grid,
                tone && "bg-tui-accent/15",
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Skeleton className="h-[38px] w-[38px]" shape="circle" row={row} tone={tone} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <Bar box="h-[21.75px]" bar="h-[9px]" width={skeletonWidth(i + 11, 42, 72)} row={row} tone={tone} />
                  <Bar box="h-[18.75px]" bar="h-[7px]" width={skeletonWidth(i + 23, 50, 80)} row={row} tone={tone} />
                </span>
              </span>
              <span className="flex">
                <span className={cn(OUTLINE, "h-6 w-[66px] rounded-full")} />
              </span>
              <Bar
                box="h-[19.5px]"
                bar="h-[8px]"
                width={skeletonWidth(i + 37, 45, 85)}
                row={row}
                tone={tone}
                className="hidden md:flex"
              />
              <span className="hidden justify-end md:flex">
                <Skeleton className="h-[7px] w-10" row={row} tone={tone} />
              </span>
            </div>
          );
        })}
      </div>

      <SkeletonSlow what="people" onRetry={onRetry} className="px-5 pb-4 sm:px-7" />
    </main>
  );
}

export function TeamPersonSkeleton() {
  const t = useTranslations("team");
  const tRoles = useTranslations("settings.workspace.roles");
  const label = usePermissionLabel();

  return (
    <div className="flex min-h-0 lg:col-span-2 xl:col-span-1">
      <div className="flex min-h-0 w-full flex-col [&>aside]:flex-1">
        <aside className={cn(TEAM_PANE, "flex min-h-0 flex-col overflow-hidden")} aria-hidden="true">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-col items-center gap-2.5 border-b border-tui-ink/8 px-6 pt-7 pb-[22px] text-center">
              <Skeleton className="h-[72px] w-[72px]" shape="circle" row={0} />
              <Bar box="h-[30px] justify-center" bar="h-[14px]" shape="title" width="140px" row={1} />
              <Bar box="h-[19.5px] justify-center" bar="h-[8px]" width="170px" row={1} />
              <Bar box="h-[18.75px] justify-center" bar="h-[7px]" width="90px" row={2} />
              <div className="mt-1.5 flex gap-2">
                <span className={cn(OUTLINE, "h-8 w-[104px] rounded-full")} />
              </div>
            </div>

            <div className="flex flex-col gap-3 border-b border-tui-ink/8 px-6 py-5">
              <span className={TEAM_EYEBROW}>{t("role")}</span>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_ROLE_ORDER.map((r) => (
                  <span
                    key={r}
                    className={cn(OUTLINE, "flex h-[30px] items-center rounded-full px-3 text-[12.5px] font-medium text-tui-ink3")}
                  >
                    {tRoles(r)}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3.5 px-6 py-5">
              <div className="flex items-baseline gap-2">
                <span className={cn(TEAM_EYEBROW, "flex-1")}>{t("can")}</span>
                <Skeleton className="h-[7px] w-24" row={4} />
              </div>
              <div className="-mx-2 flex flex-col gap-0.5">
                {PERMISSION_DISPLAY_ORDER.map((key, i) => (
                  <span key={key} className="flex items-center gap-3 px-2 py-[7px] text-[13.5px] text-tui-ink3">
                    <span className="flex h-4 w-4 flex-none overflow-hidden rounded-[4px] border border-tui-ink/16">
                      <Skeleton className="h-full w-full" row={i + 5} style={{ borderRadius: 0 }} />
                    </span>
                    <span className="flex-1">{label(key)}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** All three panes, in `TeamClient`'s grid. */
export function TeamSkeleton() {
  return (
    <div className="tui-screen flex h-full min-h-full w-full text-tui-ink">
      <div className="grid w-full grid-cols-1 gap-4 p-2 sm:px-6 sm:pt-5 sm:pb-6 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <TeamWorkspacesSkeleton />
        <TeamOrgSkeleton />
        <TeamPersonSkeleton />
      </div>
    </div>
  );
}
