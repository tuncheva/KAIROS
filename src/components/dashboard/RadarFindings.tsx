"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { relativeShort } from "./dashboardData";

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

/** Severity is a dot, a label tone and — on the lead card — a filled fix pill. */
const SEVERITY = {
  critical: {
    tone: "text-tui-danger",
    dot: "bg-tui-danger",
    pill: "border-tui-danger/50 bg-tui-danger/10",
  },
  warning: {
    tone: "text-tui-warn",
    dot: "bg-tui-warn",
    pill: "border-tui-warn/50 bg-tui-warn/10",
  },
  info: {
    tone: "text-tui-day",
    dot: "bg-tui-day",
    pill: "border-tui-day/50 bg-tui-day/10",
  },
} as const;

type Severity = keyof typeof SEVERITY;

const severityOf = (value: string): Severity =>
  value === "critical" || value === "warning" ? value : "info";

export function RadarFindings({
  className = "",
  style,
  now,
  projectTitles,
}: {
  className?: string;
  style?: CSSProperties;
  now: Date;
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

  const checked = rows.reduce<Date | null>((latest, row) => {
    const at = row.createdAt ? new Date(row.createdAt) : null;
    if (!at || Number.isNaN(at.getTime())) return latest;
    return !latest || at > latest ? at : latest;
  }, null);

  return (
    <section
      className={`border-tui-ink/12 bg-tui-pane overflow-hidden rounded-lg border shadow-[var(--tui-pane-shadow)] ${className}`}
      style={style}
    >
      <div className="border-tui-ink/8 flex items-baseline gap-3 border-b px-7 pt-5 pb-4">
        <h2 className="font-display text-tui-ink m-0 text-[22px] leading-none">
          {t("radar.title")}
        </h2>
        <span className="text-tui-ink3 text-[12.5px]">
          {findings.isLoading
            ? t("radar.loading")
            : t("radar.count", { count: rows.length })}
        </span>
        <span className="flex-1" />
        {checked && (
          <span className="text-tui-ink3 hidden text-[12.5px] sm:block">
            {t("radar.checked", { ago: relativeShort(checked, now) })}
          </span>
        )}
      </div>

      {/* Nothing found is the good case; it should look calm rather than empty. */}
      {rows.length === 0 ? (
        <p className="text-tui-ink2 px-7 py-6 text-[14px]">
          {findings.isLoading ? t("radar.loading") : t("radar.allClear")}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3">
          {rows.slice(0, 3).map((finding, index) => {
            const tone = SEVERITY[severityOf(finding.severity)];
            const project = finding.projectId
              ? (projectTitles.get(finding.projectId) ?? null)
              : null;

            return (
              <article
                key={finding.id}
                className={`flex flex-col gap-3 px-7 py-6 ${
                  index > 0
                    ? "border-tui-ink/8 border-t md:border-t-0 md:border-l"
                    : ""
                }`}
              >
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${tone.dot}`}
                    aria-hidden
                  />
                  <span className={tone.tone}>
                    {t(`radar.severity.${severityOf(finding.severity)}`)}
                  </span>
                  <span className="flex-1" />
                  <span className="font-display text-tui-ink3 truncate text-[14px] italic">
                    {project ?? t("radar.workspaceWide")}
                  </span>
                </div>

                <h3 className="font-display text-tui-ink m-0 text-[21px] leading-[1.25] font-normal text-pretty">
                  {finding.title}
                </h3>
                <p className="text-tui-ink2 m-0 text-[14px] leading-[1.6] text-pretty">
                  {finding.detail}
                </p>

                <div className="mt-1.5 flex items-center gap-4 text-[13px]">
                  {finding.suggestedFix ? (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/chat/ai?prefill=${encodeURIComponent(finding.suggestedFix!.prompt)}`,
                        )
                      }
                      className={`text-tui-ink flex h-[34px] items-center rounded-full border px-3.5 font-medium transition-opacity hover:opacity-80 ${
                        index === 0 ? tone.pill : "border-tui-ink/16"
                      }`}
                    >
                      {finding.suggestedFix.label} →
                    </button>
                  ) : finding.projectId ? (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/projects?projectId=${finding.projectId}`)
                      }
                      className="border-tui-ink/16 text-tui-ink hover:bg-tui-ink/[0.04] flex h-[34px] items-center rounded-full border px-3.5 font-medium transition-colors"
                    >
                      {t("radar.openProject")}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => dismiss.mutate({ findingId: finding.id })}
                    disabled={dismiss.isPending}
                    className="text-tui-ink3 hover:text-tui-ink2 transition-colors disabled:opacity-50"
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
