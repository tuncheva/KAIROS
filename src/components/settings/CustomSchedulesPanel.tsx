"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Translator = (key: string, values?: Record<string, unknown>) => string;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Sunday-first, matching `Date.getDay` and the stored `dayOfWeek`. */
const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Questions the user saves to run on a timer.
 *
 * The Daily Brief and Risk Radar are two fixed questions; this makes the
 * scheduler an open surface — "every Monday, list the unassigned tasks in Delta".
 * The runner, the per-plan cap and the read-only tool binding all exist; this is
 * the form that was missing.
 *
 * Sits under the built-in schedules rather than in its own card. Someone who has
 * just set their brief to 07:00 is in exactly the frame of mind to add a question
 * of their own, and splitting the two would make the built-ins look like a
 * different feature.
 *
 * Two things the form says out loud, because neither is guessable:
 *
 * - **A schedule can only read.** It runs against A1's read-only tools with the
 *   memory-writing ones withheld, so "every Monday, assign the unassigned tasks"
 *   will report rather than act. A user should learn that here and not from a
 *   week of silence.
 * - **The allowance, before it is hit.** `2 of 3 used` is a fact; discovering the
 *   cap as a refusal when you press Add is a papercut.
 */
export function CustomSchedulesPanel({ timeZone }: { timeZone: string }) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.ai");

  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const schedules = api.agent.customSchedules.useQuery(undefined, {
    retry: false,
  });
  const invalidate = () => void utils.agent.customSchedules.invalidate();

  const create = api.agent.createCustomSchedule.useMutation({
    onSuccess: () => {
      setName("");
      setPrompt("");
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const update = api.agent.updateCustomSchedule.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const remove = api.agent.deleteCustomSchedule.useMutation({
    onSuccess: invalidate,
  });

  const rows = schedules.data?.schedules ?? [];
  const allowance = schedules.data?.allowance ?? 0;
  const atCap = rows.length >= allowance;

  return (
    <div className="mt-4 border-t border-border-light pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-fg-primary">
          {t("ownSchedulesTitle")}
        </h4>
        <span className="text-xs text-fg-tertiary">
          {t("ownSchedulesUsed", { used: rows.length, max: allowance })}
        </span>
      </div>

      <p className="mt-0.5 mb-3 text-xs text-fg-tertiary">
        {t("ownSchedulesReadOnly")}
      </p>

      {error ? (
        <p className="mb-2 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}

      {schedules.isLoading ? (
        <p className="text-sm text-fg-tertiary">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-tertiary">{t("ownSchedulesEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border-light bg-bg-secondary p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg-primary">
                  {row.name}
                </p>
                <p className="mt-0.5 text-xs italic text-fg-tertiary">
                  &ldquo;{row.prompt}&rdquo;
                </p>
                {row.lastError ? (
                  <p className="mt-1 text-xs text-error">
                    {t("lastFailed", { error: row.lastError })}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <select
                  value={row.dayOfWeek ?? -1}
                  disabled={update.isPending}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    update.mutate({
                      id: row.id,
                      // -1 is the sentinel for "every day"; the column stores
                      // null for that, and `0` is a real choice (Sunday).
                      dayOfWeek: value < 0 ? null : value,
                    });
                  }}
                  className="rounded-md border border-border-medium bg-bg-elevated px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
                >
                  <option value={-1}>{t("everyDay")}</option>
                  {WEEKDAY_KEYS.map((key, index) => (
                    <option key={key} value={index}>
                      {t(key)}
                    </option>
                  ))}
                </select>

                <select
                  value={row.hourLocal}
                  disabled={update.isPending}
                  onChange={(e) =>
                    update.mutate({
                      id: row.id,
                      hourLocal: Number(e.target.value),
                    })
                  }
                  className="rounded-md border border-border-medium bg-bg-elevated px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>

                <select
                  value={row.channel}
                  disabled={update.isPending}
                  onChange={(e) =>
                    update.mutate({
                      id: row.id,
                      channel: e.target.value as "app" | "email" | "both",
                    })
                  }
                  className="rounded-md border border-border-medium bg-bg-elevated px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
                >
                  <option value="app">{t("channelApp")}</option>
                  <option value="email">{t("channelEmail")}</option>
                  <option value="both">{t("channelBoth")}</option>
                </select>

                <button
                  type="button"
                  onClick={() =>
                    update.mutate({ id: row.id, enabled: !row.enabled })
                  }
                  disabled={update.isPending}
                  className="rounded-md border border-border-medium px-2 py-1 text-xs text-fg-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
                >
                  {row.enabled ? t("pause") : t("resume")}
                </button>

                <button
                  type="button"
                  onClick={() => remove.mutate({ id: row.id })}
                  disabled={remove.isPending}
                  className="rounded-md px-2 py-1 text-xs text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                >
                  {t("removeSchedule")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {atCap ? (
        <p className="mt-3 text-xs text-fg-tertiary">
          {allowance === 0
            ? t("ownSchedulesProOnly")
            : t("ownSchedulesLimit", { max: allowance })}
        </p>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmedName = name.trim();
            const trimmedPrompt = prompt.trim();
            if (trimmedName.length < 2 || trimmedPrompt.length < 5) return;
            create.mutate({ name: trimmedName, prompt: trimmedPrompt });
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder={t("schedulePlaceholderName")}
            className="w-full rounded-md border border-border-medium bg-bg-elevated px-3 py-1.5 text-sm text-fg-primary sm:w-48"
          />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={500}
            placeholder={t("schedulePlaceholderPrompt")}
            className="min-w-0 flex-1 rounded-md border border-border-medium bg-bg-elevated px-3 py-1.5 text-sm text-fg-primary"
          />
          <button
            type="submit"
            disabled={
              create.isPending || name.trim().length < 2 || prompt.trim().length < 5
            }
            className="shrink-0 rounded-lg border border-border-medium px-3 py-1.5 text-sm font-medium text-fg-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
          >
            {create.isPending ? t("sending") : t("addSchedule")}
          </button>
        </form>
      )}

      <p className="mt-2 text-xs text-fg-quaternary">
        {t("timeZoneHint", { zone: timeZone })}
      </p>
    </div>
  );
}
