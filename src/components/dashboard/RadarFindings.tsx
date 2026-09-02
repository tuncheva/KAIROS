"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowRight, Radar } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { relativeShort } from "./dashboardData";

/**
 * B-2 / B-3 — what the Risk Radar found, and the one-click fix for it.
 *
 * The whole argument for proactive AI lives or dies here. A panel that only says
 * "6 tasks are overdue" is a nag: the user already knows, and telling them again
 * every morning is how a feature gets switched off. What makes it worth the
 * interruption is that each finding arrives with the fix already drafted — one
 * click seeds the chat with a request the planner can act on, instead of making
 * the user retype the problem back to the assistant that just reported it.
 *
 * Dismiss is given equal weight to the fix, deliberately. A finding the user
 * does not care about must be cheap to make go away, and the dismissal rate is
 * the number that tells us whether the thresholds in `riskRadar.ts` are right.
 *
 * The design puts this directly under the headline as a row of cards rather
 * than in a panel below the fold: severity paints the left edge and the label
 * only, so three findings read as three things to look at rather than as an
 * alarm going off.
 */

type Translator = (key: string, values?: Record<string, unknown>) => string;

/** Severity is an edge, a wash and a label — never a fill. */
const SEVERITY = {
  critical: {
    edge: "border-l-error",
    wash: "bg-error/5",
    label: "text-error",
    button: "border-error/40 bg-error/[0.16]",
  },
  warning: {
    edge: "border-l-warning",
    wash: "bg-warning/5",
    label: "text-warning",
    button: "border-warning/40 bg-warning/[0.16]",
  },
  info: {
    edge: "border-l-info",
    wash: "bg-info/5",
    label: "text-info",
    button: "border-info/40 bg-info/[0.16]",
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
  const t = useT("dashboard.radar");
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

  /* When the radar last had something to say. There is no "last run" column —
     findings are written as they are raised, so the newest one is the honest
     answer to "is this current?". */
  const checked = rows.reduce<Date | null>((latest, row) => {
    const at = row.createdAt ? new Date(row.createdAt) : null;
    if (!at || Number.isNaN(at.getTime())) return latest;
    return !latest || at > latest ? at : latest;
  }, null);

  return (
    <section className={`flex flex-col gap-3 ${className}`} style={style}>
      <div className="flex items-baseline gap-3">
        <Radar size={15} className="self-center text-accent-primary" aria-hidden />
        <h2 className="m-0 text-base font-semibold tracking-[-0.012em] text-fg-primary">
          {t("title")}
        </h2>
        <span className="font-mono text-[11px] text-fg-quaternary">
          {findings.isLoading ? t("loading") : t("count", { count: rows.length })}
        </span>
        <span className="flex-1" />
        {checked && (
          <span className="hidden font-mono text-[11px] text-fg-quaternary sm:block">
            {t("checked", { ago: relativeShort(checked, now) })}
          </span>
        )}
      </div>

      {/* Nothing found is the good case, and it should look like it rather than
          like an empty state that suggests something failed to load. */}
      {rows.length === 0 ? (
        <p className="rounded-[11px] border border-border-light/60 bg-bg-elevated px-[19px] py-4 text-[13px] text-fg-tertiary">
          {findings.isLoading ? t("loading") : t("allClear")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {rows.slice(0, 3).map((finding) => {
            const tone = SEVERITY[severityOf(finding.severity)];
            const project = finding.projectId
              ? (projectTitles.get(finding.projectId) ?? null)
              : null;

            return (
              <article
                key={finding.id}
                className={`flex min-h-[172px] flex-col gap-2.5 rounded-[11px] border border-l-[3px] border-border-light/60 px-[19px] pb-[15px] pt-[17px] ${tone.edge} ${tone.wash}`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.14em] ${tone.label}`}
                  >
                    {t(`severity.${severityOf(finding.severity)}`)}
                  </span>
                  <span className="flex-1" />
                  <span className="truncate font-mono text-[10px] text-fg-quaternary">
                    {project ?? t("workspaceWide")}
                  </span>
                </div>

                <h3 className="m-0 text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-fg-primary">
                  {finding.title}
                </h3>
                <p className="text-[13px] leading-[1.5] text-fg-tertiary">{finding.detail}</p>

                <span className="flex-1" />

                <div className="flex items-center gap-2.5">
                  {finding.suggestedFix ? (
                    <button
                      type="button"
                      onClick={() =>
                        // Seed the chat rather than acting directly: this is
                        // still a write, and a write still goes through draft →
                        // confirm → apply. The saving is the typing, never the
                        // review.
                        router.push(
                          `/chat/ai?prefill=${encodeURIComponent(finding.suggestedFix!.prompt)}`,
                        )
                      }
                      className={`flex items-center gap-[7px] rounded-[7px] border px-[11px] py-[7px] text-xs font-semibold text-fg-primary transition-opacity hover:opacity-80 ${tone.button}`}
                    >
                      {finding.suggestedFix.label}
                      <ArrowRight size={13} aria-hidden />
                    </button>
                  ) : finding.projectId ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/projects?projectId=${finding.projectId}`)}
                      className="rounded-[7px] border border-border-medium px-[11px] py-[7px] text-xs font-semibold text-fg-primary transition-colors hover:bg-bg-tertiary"
                    >
                      {t("openProject")}
                    </button>
                  ) : null}

                  <span className="flex-1" />

                  <button
                    type="button"
                    onClick={() => dismiss.mutate({ findingId: finding.id })}
                    disabled={dismiss.isPending}
                    className="text-xs text-fg-quaternary transition-colors hover:text-fg-secondary disabled:opacity-50"
                  >
                    {t("dismiss")}
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
