"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

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
 */

type Translator = (key: string, values?: Record<string, unknown>) => string;

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-l-error bg-error/5",
  warning: "border-l-warning bg-warning/5",
  info: "border-l-info bg-info/5",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "text-error",
  warning: "text-warning",
  info: "text-info",
};

export function AiInsightsPanel({ className = "" }: { className?: string }) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("ai.insights");
  const router = useRouter();

  const utils = api.useUtils();
  const findings = api.agent.findings.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const dismiss = api.agent.dismissFinding.useMutation({
    onSuccess: () => utils.agent.findings.invalidate(),
  });

  // Nothing found is the good case, and it should look like it rather than like
  // an empty state that suggests something failed to load.
  if (findings.isLoading) {
    return (
      <div className={`rounded-xl border border-border-light bg-bg-elevated p-5 ${className}`}>
        <p className="text-sm text-fg-tertiary">{t("loading")}</p>
      </div>
    );
  }

  const rows = findings.data ?? [];

  if (rows.length === 0) {
    return (
      <div className={`rounded-xl border border-border-light bg-bg-elevated p-5 ${className}`}>
        <h3 className="text-base font-semibold text-fg-primary">{t("title")}</h3>
        <p className="mt-1 text-sm text-fg-secondary">{t("allClear")}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border-light bg-bg-elevated p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-fg-primary">{t("title")}</h3>
        <span className="text-xs tabular-nums text-fg-tertiary">
          {t("count", { count: rows.length })}
        </span>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((finding) => (
          <li
            key={finding.id}
            className={`rounded-lg border border-border-light border-l-4 p-3 ${
              SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    SEVERITY_LABEL[finding.severity] ?? "text-fg-primary"
                  }`}
                >
                  {finding.title}
                </p>
                <p className="mt-0.5 text-sm text-fg-secondary">{finding.detail}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {finding.suggestedFix ? (
                <button
                  type="button"
                  onClick={() =>
                    // Seed the chat rather than acting directly: this is still a
                    // write, and a write still goes through draft → confirm →
                    // apply. The saving is the typing, never the review.
                    router.push(
                      `/chat/ai?prefill=${encodeURIComponent(finding.suggestedFix!.prompt)}`,
                    )
                  }
                  className="rounded-lg bg-accent-primary px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  {finding.suggestedFix.label}
                </button>
              ) : null}

              {finding.projectId ? (
                <button
                  type="button"
                  onClick={() => router.push(`/projects/${finding.projectId}`)}
                  className="rounded-lg border border-border-medium px-3 py-1.5 text-sm text-fg-primary transition-colors hover:bg-bg-tertiary"
                >
                  {t("openProject")}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => dismiss.mutate({ findingId: finding.id })}
                disabled={dismiss.isPending}
                className="ml-auto rounded-lg px-3 py-1.5 text-sm text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-secondary disabled:opacity-50"
              >
                {t("dismiss")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
