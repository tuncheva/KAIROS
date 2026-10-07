"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { Skeleton, SkeletonStatus } from "~/components/ui/Skeleton";
import { useSkeletonHold } from "~/hooks/useSkeletonHold";
import { relativeShort } from "./dashboardData";
import { RadarFindingsSkeletonBody } from "./DashboardSkeleton";

/**
 * B-2 / B-3 — what the Risk Radar found, and the one-click fix for it.
 *
 * The whole argument for proactive AI lives or dies here. A panel that only says
 * "6 tasks are overdue" is a nag: the user already knows. What makes it worth the
 * interruption is that each finding arrives with the fix already drafted — one
 * click seeds the chat with a request the planner can act on.
 *
 * Dismiss is given equal weight to the fix, deliberately: a finding the user does
 * not care about must be cheap to make go away, and the dismissal rate is what
 * tells us whether the thresholds in `riskRadar.ts` are right.
 */

type Translator = (key: string, values?: Record<string, unknown>) => string;

/** Severity is a dot and a label tone; the rest of the row stays ink. */
const SEVERITY = {
  critical: { tone: "text-tui-danger", dot: "bg-tui-danger" },
  warning: { tone: "text-tui-warn", dot: "bg-tui-warn" },
  info: { tone: "text-tui-day", dot: "bg-tui-day" },
} as const;

/** The fix and "open project" share one outline pill that fills with ink on hover. */
const ACTION =
  "border-tui-ink/16 text-tui-ink hover:border-tui-ink hover:bg-tui-ink hover:text-tui-pane flex h-[30px] items-center rounded-full border px-3.5 text-[12.5px] font-medium whitespace-nowrap transition-colors";

type Severity = keyof typeof SEVERITY;

const severityOf = (value: string): Severity =>
  value === "critical" || value === "warning" ? value : "info";

export function RadarFindings({
  className = "",
  style,
  now,
  projectTitles,
  agentName,
}: {
  className?: string;
  style?: CSSProperties;
  now: Date;
  /** What the workspace calls the radar agent — it signs the card. */
  agentName?: string;
  /** Findings carry a project id; the dashboard already knows the titles. */
  projectTitles: Map<number, string | null>;
}) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("dashboard");
  const router = useRouter();

  const utils = api.useUtils();
  const findings = api.agent.findings.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const dismiss = api.agent.dismissFinding.useMutation({
    onSuccess: () => utils.agent.findings.invalidate(),
  });

  const rows = findings.data ?? [];
  const loading = useSkeletonHold(findings.isLoading);

  const checked = rows.reduce<Date | null>((latest, row) => {
    const at = row.createdAt ? new Date(row.createdAt) : null;
    if (!at || Number.isNaN(at.getTime())) return latest;
    return !latest || at > latest ? at : latest;
  }, null);

  return (
    <section
      className={`border-tui-ink/10 bg-tui-pane overflow-hidden rounded-[14px] border shadow-[var(--tui-pane-shadow)] ${className}`}
      style={style}
    >
      <div className="flex items-baseline gap-3 px-[18px] pt-[22px] pb-4 sm:px-7">
        <h2 className="font-display text-tui-ink m-0 text-[24px] leading-none tracking-[-0.005em]">
          {t("radar.title")}
        </h2>
        {loading ? (
          <Skeleton className="h-[8px] w-[64px] self-center" />
        ) : (
          <span className="text-tui-ink3 text-[12.5px]">
            {t("radar.count", { count: rows.length })}
          </span>
        )}
        <span className="flex-1" />
        {checked && (
          <span className="text-tui-ink3 hidden text-[12.5px] sm:block">
            {agentName ? `${agentName} · ` : ""}
            {t("radar.checked", { ago: relativeShort(checked, now) })}
          </span>
        )}
      </div>
      <div className="bg-tui-ink/8 mx-[18px] h-px sm:mx-7" />

      {/* Nothing found is the good case; it should look calm rather than empty. */}
      {loading ? (
        <>
          <SkeletonStatus label={t("radar.loading")} />
          <RadarFindingsSkeletonBody row={1} />
        </>
      ) : rows.length === 0 ? (
        <p className="text-tui-ink2 m-0 px-[18px] py-6 text-[14px] sm:px-7">
          {t("radar.allClear")}
        </p>
      ) : (
        <div className="py-1">
          {rows.slice(0, 3).map((finding) => {
            const severity = severityOf(finding.severity);
            const tone = SEVERITY[severity];
            const project = finding.projectId
              ? (projectTitles.get(finding.projectId) ?? null)
              : null;

            return (
              <article
                key={finding.id}
                className="border-tui-ink/6 grid grid-cols-1 items-center gap-3 border-t px-[18px] py-[18px] first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 sm:px-7"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[10.5px] font-medium tracking-[0.16em] uppercase">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${tone.dot}`}
                      aria-hidden
                    />
                    <span className={tone.tone}>
                      {t(`radar.severity.${severity}`)}
                    </span>
                    <span className="text-tui-ink3 truncate tracking-normal normal-case">
                      · {project ?? t("radar.workspaceWide")}
                    </span>
                  </div>
                  <h3 className="text-tui-ink m-0 mt-1.5 mb-1 text-[14.5px] leading-[1.4] font-medium text-pretty">
                    {finding.title}
                  </h3>
                  <p className="text-tui-ink3 m-0 text-[13px] leading-[1.55] text-pretty">
                    {finding.detail}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {finding.suggestedFix ? (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/chat/ai?prefill=${encodeURIComponent(finding.suggestedFix!.prompt)}`,
                        )
                      }
                      className={ACTION}
                    >
                      {finding.suggestedFix.label}
                    </button>
                  ) : finding.projectId ? (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/projects?projectId=${finding.projectId}`)
                      }
                      className={ACTION}
                    >
                      {t("radar.openProject")}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => dismiss.mutate({ findingId: finding.id })}
                    disabled={dismiss.isPending}
                    className="text-tui-ink3 hover:text-tui-ink h-[30px] px-2.5 text-[12.5px] transition-colors disabled:opacity-50"
                  >
                    {t("radar.dismiss")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
