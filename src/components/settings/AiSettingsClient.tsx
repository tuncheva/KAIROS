"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Settings → AI.
 *
 * Two features that cannot ship without it:
 *
 * - **Consent (B-4).** Proactive briefs are off until someone turns them on
 *   here. A product that starts messaging people because it was deployed is a
 *   product people mute.
 * - **Inspectable memory (C-2).** Every stored fact is listed verbatim with a
 *   delete button next to it. A memory you cannot see is a memory you cannot
 *   correct, and an assistant that "just knows things" about you is unnerving
 *   rather than helpful.
 *
 * The quota row is here too, because the honest answer to "why did it stop
 * replying?" is a number, and it was previously only available to the code.
 */

type Translator = (key: string, values?: Record<string, unknown>) => string;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-light bg-bg-elevated p-5">
      <h3 className="text-base font-semibold text-fg-primary">{title}</h3>
      <p className="mt-1 text-sm text-fg-secondary">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
        checked ? "bg-accent-primary" : "bg-border-strong"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function AiSettingsClient() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.ai");

  const utils = api.useUtils();
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);

  const memory = api.agent.memory.useQuery(undefined, { retry: false });
  const schedules = api.agent.schedules.useQuery(undefined, { retry: false });
  const metrics = api.agent.metrics.useQuery({ days: 30 }, { retry: false });
  const stats = api.agent.findingStats.useQuery(undefined, { retry: false });

  const forget = api.agent.forgetMemory.useMutation({
    onSuccess: () => utils.agent.memory.invalidate(),
  });
  const clearAll = api.agent.clearMemory.useMutation({
    onSuccess: () => utils.agent.memory.invalidate(),
  });
  const setSchedule = api.agent.setSchedule.useMutation({
    onSuccess: () => utils.agent.schedules.invalidate(),
  });
  const preview = api.agent.previewBrief.useMutation({
    onSuccess: (res) => setPreviewMessage(res.message),
  });

  const quota = metrics.data?.quota;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h2 className="text-xl font-semibold text-fg-primary">{t("title")}</h2>
        <p className="mt-1 text-sm text-fg-secondary">{t("subtitle")}</p>
      </header>

      {/* ---- Proactive ---------------------------------------------------- */}
      <Card title={t("proactiveTitle")} description={t("proactiveDescription")}>
        <div className="flex flex-col gap-4">
          {(schedules.data ?? []).map((schedule) => (
            <div
              key={schedule.kind}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-light bg-bg-secondary p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg-primary">
                  {t(
                    schedule.kind === "daily_brief"
                      ? "dailyBriefTitle"
                      : "riskRadarTitle",
                  )}
                </p>
                <p className="text-xs text-fg-tertiary">
                  {t(
                    schedule.kind === "daily_brief"
                      ? "dailyBriefDescription"
                      : "riskRadarDescription",
                  )}
                </p>
                {schedule.lastError ? (
                  <p className="mt-1 text-xs text-error">
                    {t("lastFailed", { error: schedule.lastError })}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  {t("atHour")}
                  <select
                    value={schedule.hourUtc}
                    disabled={!schedule.enabled || setSchedule.isPending}
                    onChange={(e) =>
                      setSchedule.mutate({
                        kind: schedule.kind,
                        enabled: schedule.enabled,
                        hourUtc: Number(e.target.value),
                      })
                    }
                    className="rounded-md border border-border-medium bg-bg-elevated px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00 UTC
                      </option>
                    ))}
                  </select>
                </label>

                <Toggle
                  checked={schedule.enabled}
                  disabled={setSchedule.isPending}
                  label={t("enableToggle")}
                  onChange={(next) =>
                    setSchedule.mutate({
                      kind: schedule.kind,
                      enabled: next,
                      hourUtc: schedule.hourUtc,
                    })
                  }
                />
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => preview.mutate()}
              disabled={preview.isPending}
              className="rounded-lg border border-border-medium px-3 py-1.5 text-sm text-fg-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
            >
              {preview.isPending ? t("sending") : t("previewBrief")}
            </button>
            {previewMessage ? (
              <p className="text-xs text-fg-secondary">{previewMessage}</p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ---- Memory ------------------------------------------------------- */}
      <Card title={t("memoryTitle")} description={t("memoryDescription")}>
        {memory.isLoading ? (
          <p className="text-sm text-fg-tertiary">{t("loading")}</p>
        ) : (memory.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-fg-tertiary">{t("memoryEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {memory.data?.map((fact) => (
              <div
                key={fact.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border-light bg-bg-secondary p-3"
              >
                <div className="min-w-0">
                  {/* The value verbatim: paraphrasing what it remembers would
                      defeat the point of showing it. */}
                  <p className="text-sm text-fg-primary">{fact.value}</p>
                  <p className="mt-0.5 font-mono text-xs text-fg-quaternary">
                    {fact.key}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => forget.mutate({ id: fact.id })}
                  disabled={forget.isPending}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                >
                  {t("forget")}
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => clearAll.mutate()}
              disabled={clearAll.isPending}
              className="self-start rounded-lg border border-border-medium px-3 py-1.5 text-sm text-error transition-colors hover:bg-error/10 disabled:opacity-50"
            >
              {t("forgetEverything")}
            </button>
          </div>
        )}
      </Card>

      {/* ---- Usage -------------------------------------------------------- */}
      <Card title={t("usageTitle")} description={t("usageDescription")}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border-light bg-bg-secondary p-3">
            <dt className="text-xs text-fg-tertiary">{t("quotaRemaining")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">
              {quota ? `${quota.interactive.remaining}/${quota.interactive.limit}` : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-border-light bg-bg-secondary p-3">
            <dt className="text-xs text-fg-tertiary">{t("quotaSystem")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">
              {quota ? `${quota.system.remaining}/${quota.system.limit}` : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-border-light bg-bg-secondary p-3">
            <dt className="text-xs text-fg-tertiary">{t("tokens30d")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">
              {metrics.data
                ? metrics.data.window.totalTokens.toLocaleString()
                : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-border-light bg-bg-secondary p-3">
            <dt className="text-xs text-fg-tertiary">{t("dismissalRate")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">
              {stats.data ? `${stats.data.dismissalRate}%` : "—"}
            </dd>
          </div>
        </dl>

        {(metrics.data?.latencyByAgent.length ?? 0) > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-fg-quaternary">
                  <th className="pb-2 font-medium">{t("agent")}</th>
                  <th className="pb-2 text-right font-medium">p50</th>
                  <th className="pb-2 text-right font-medium">p95</th>
                  <th className="pb-2 text-right font-medium">{t("samples")}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.data?.latencyByAgent.map((row) => (
                  <tr key={row.agentId} className="border-t border-border-light">
                    <td className="py-1.5 text-fg-secondary">{row.agentId}</td>
                    <td className="py-1.5 text-right tabular-nums text-fg-primary">
                      {(row.p50Ms / 1000).toFixed(1)}s
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-fg-primary">
                      {(row.p95Ms / 1000).toFixed(1)}s
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-fg-tertiary">
                      {row.samples}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
