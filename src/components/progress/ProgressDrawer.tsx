"use client";

import { useId, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { Overlay } from "~/components/ui/Overlay";
import { ModalDismiss, useModalBehavior } from "~/components/ui/Modal";
import { ProgressGrid } from "./ProgressGrid";
import { FinishedLog, STAMP, WorkloadList, roleLabel } from "./ProgressPanels";
import {
  RECORD_DAYS,
  RECORD_WEEKS,
  buildGrid,
  buildLog,
  countByDay,
  displayName,
  initialsOf,
  normaliseEntries,
  summarise,
  type TeamMemberPayload,
  type WindowKey,
} from "./progressModel";

/**
 * One teammate's record, over the page rather than instead of it.
 *
 * It used to be a card that pushed the whole layout sideways; as a drawer the
 * table or the standings it was opened from stay exactly where they were, so
 * reading five people in a row is five opens and five Escapes, not five
 * reflows. Opened from the standings by anyone in the workspace — the server
 * has always allowed that — and from the team table by admins.
 */
export function MemberDrawer({
  userId,
  member,
  closing,
  onClose,
  today,
  windowKey,
  formatMonth,
  formatDay,
  gridLabels,
}: {
  userId: string;
  /** Known when opened from the team table: carries the role. */
  member?: TeamMemberPayload;
  closing: boolean;
  onClose: () => void;
  today: Date;
  windowKey: WindowKey;
  formatMonth: (date: Date) => string;
  formatDay: (date: Date) => string;
  gridLabels: {
    less: string;
    more: string;
    hint: string;
    dayCount: (day: string, count: number) => string;
  };
}) {
  const t = useTranslations("progress.record");
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);

  useModalBehavior({ containerRef: panelRef, onDismiss: onClose });

  const record = api.progress.getRecord.useQuery(
    { userId, days: RECORD_DAYS },
    { staleTime: 30_000 },
  );
  const data = record.data;

  const tasks = useMemo(() => normaliseEntries(data?.entries), [data?.entries]);
  const counts = useMemo(() => countByDay(tasks), [tasks]);
  const summary = useMemo(() => summarise({ today, counts, window: windowKey }), [today, counts, windowKey]);
  const weeks = useMemo(() => buildGrid({ today, counts, window: windowKey }), [today, counts, windowKey]);
  const log = useMemo(
    () => buildLog({ today, tasks, window: windowKey, selectedYmd: null }),
    [today, tasks, windowKey],
  );

  const open = (data?.workload ?? []).reduce((total, entry) => total + entry.open, 0);
  const running = summary.streak >= 3;
  const person = data?.person ?? member;
  const name = person ? displayName(person) || t("boardUnknown") : "";

  const stats = [
    { key: "finished", label: t("statFinished"), value: String(summary.finished), tone: "text-tui-ink" },
    {
      key: "streak",
      label: t("statStreak"),
      value: t("streakDays", { count: summary.streak }),
      tone: running ? "text-tui-ok" : "text-tui-ink",
    },
    { key: "open", label: t("colOpen"), value: String(open), tone: "text-tui-ink" },
    {
      key: "best",
      label: t("statBestDay"),
      value: String(summary.bestCount),
      tone: "text-tui-ink",
    },
  ];

  return (
    <Overlay>
      <div
        className={cn("fixed inset-0 z-[70] flex justify-end", closing && "pointer-events-none")}
      >
        <button
          type="button"
          aria-label={t("close")}
          tabIndex={-1}
          onClick={onClose}
          className={cn(
            "absolute inset-0 bg-black/45 backdrop-blur-[2px]",
            closing ? "projects-drawer-scrim-out" : "projects-drawer-scrim",
          )}
        />

        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={cn(
            "kairos-sheet-right border-tui-ink/10 bg-tui-pane text-tui-ink relative flex h-full w-full max-w-[480px] flex-col border-l pt-[var(--kairos-safe-top)] pb-[var(--kairos-safe-bottom)] shadow-[-40px_0_80px_-40px_rgba(0,0,0,0.6)]",
            closing ? "projects-drawer-out" : "projects-drawer",
          )}
        >
          <div className="flex items-center justify-between gap-4 px-7 pt-7 sm:px-11 sm:pt-9">
            <span className="text-tui-accent font-mono text-[10.5px] tracking-[0.22em] uppercase">
              {t("drawerEyebrow")}
            </span>
            <ModalDismiss onDismiss={onClose} label={t("close")} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-10 sm:px-11">
            <div className="mt-8 flex items-center gap-4">
              <span className="bg-tui-ink/10 text-tui-ink2 grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full text-[16px] font-bold">
                {person ? initialsOf(person) : ""}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h2 id={titleId} className="font-display m-0 truncate text-[36px] leading-none font-normal">
                  {name || " "}
                </h2>
                <span className="text-tui-ink3 font-mono text-[10px] tracking-[0.18em] uppercase">
                  {member
                    ? roleLabel(t, member)
                    : t("profileProjects", { count: data?.workload.length ?? 0 })}
                </span>
              </div>
            </div>

            {record.error ? (
              <p className="text-tui-danger mt-8 text-[14px]">{record.error.message}</p>
            ) : !data ? (
              <div className="mt-8 flex flex-col gap-4" aria-hidden="true">
                <div className="kairos-shimmer h-40 rounded-md" />
                <div className="kairos-shimmer h-32 rounded-md" />
              </div>
            ) : (
              <>
                <div className="border-tui-ink/10 mt-8 grid grid-cols-2 border-t">
                  {stats.map((stat, index) => (
                    <div
                      key={stat.key}
                      className={cn(
                        "border-tui-ink/10 flex flex-col gap-2 border-b py-5",
                        index % 2 === 1 && "border-l pl-5",
                      )}
                    >
                      <span className={cn(STAMP, "text-[9.5px]")}>{stat.label}</span>
                      <span className={cn("font-display text-[40px] leading-none tabular-nums", stat.tone)}>
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>

                <span className={cn(STAMP, "mt-8 text-[9.5px]")}>
                  {t("drawerWeeks", { weeks: RECORD_WEEKS })}
                </span>
                <div className="mt-3">
                  <ProgressGrid
                    weeks={weeks}
                    size="sm"
                    formatMonth={formatMonth}
                    formatDay={formatDay}
                    labels={gridLabels}
                  />
                </div>

                <span className={cn(STAMP, "mt-8 mb-3.5 text-[9.5px]")}>{t("drawerStillOn")}</span>
                <WorkloadList workload={data.workload} today={today} />

                <span className={cn(STAMP, "mt-8 text-[9.5px]")}>{t("logRecent")}</span>
                <FinishedLog groups={log} today={today} compact />
              </>
            )}
          </div>
        </aside>
      </div>
    </Overlay>
  );
}
