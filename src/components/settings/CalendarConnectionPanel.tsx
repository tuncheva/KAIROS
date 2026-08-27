"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useDateFormat } from "~/hooks/useDateFormat";
import { api } from "~/trpc/react";

type Translator = (key: string, values?: Record<string, unknown>) => string;

/**
 * Connect a calendar, so the assistant knows about real meetings.
 *
 * Sits above the proactive schedules rather than in its own section, because it
 * is a precondition for one of them: meeting prep is inert without a calendar,
 * and a user who turns it on should see why nothing arrives.
 *
 * **Connecting is a browser redirect, not a mutation.** OAuth requires the user
 * to visit Google, so this is a plain link to `/api/calendar/google/connect`
 * rather than a tRPC call — and the callback returns them here with a
 * `?calendar=` reason so the outcome can be reported rather than silently
 * assumed.
 *
 * Read-only is stated in the description, not buried. A user granting access to
 * their entire calendar deserves to know the grant cannot write.
 */
export function CalendarConnectionPanel() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.ai");
  const { formatDate } = useDateFormat();

  const params = useSearchParams();
  const utils = api.useUtils();

  // The callback's outcome, shown once. Held in state so dismissing it does not
  // require a navigation.
  const [outcome, setOutcome] = useState<string | null>(
    params.get("calendar"),
  );

  const calendar = api.integration.calendar.useQuery(undefined, {
    retry: false,
  });
  const invalidate = () => void utils.integration.calendar.invalidate();

  const sync = api.integration.syncCalendar.useMutation({
    onSuccess: invalidate,
  });
  const disconnect = api.integration.disconnectCalendar.useMutation({
    onSuccess: invalidate,
  });

  const data = calendar.data;
  const connection = data?.connection ?? null;

  return (
    <section className="rounded-xl border border-border-light bg-bg-elevated p-5">
      <h3 className="text-base font-semibold text-fg-primary">
        {t("calendarTitle")}
      </h3>
      <p className="mt-0.5 mb-4 text-sm text-fg-tertiary">
        {t("calendarDescription")}
      </p>

      {outcome ? <OutcomeBanner reason={outcome} onDismiss={() => setOutcome(null)} t={t} /> : null}

      {calendar.isLoading ? (
        <p className="text-sm text-fg-tertiary">{t("loading")}</p>
      ) : !data?.entitled ? (
        // A plan limit. An upgrade prompt, not an error.
        <p className="text-sm text-fg-tertiary">{t("calendarProOnly")}</p>
      ) : !data.configured ? (
        // A deployment gap: no Google client id. The user can do nothing about
        // it, so there is no button — only an honest statement.
        <p className="text-sm text-fg-tertiary">{t("calendarUnavailable")}</p>
      ) : connection === null ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-tertiary">{t("calendarNone")}</p>
          <a
            href="/api/calendar/google/connect"
            className="self-start rounded-lg bg-accent-primary px-3 py-1.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
          >
            {t("calendarConnect")}
          </a>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border-light bg-bg-secondary p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg-primary">
              {connection.accountEmail ?? connection.provider}
            </p>
            <p className="mt-0.5 text-xs text-fg-quaternary">
              {connection.lastSyncedAt
                ? t("calendarSynced", {
                    count: data.eventCount,
                    when: formatDate(new Date(connection.lastSyncedAt)),
                  })
                : t("calendarNeverSynced")}
            </p>
            {/*
              A failing connection says so here rather than only in a log. The
              usual cause is a revoked grant, and the fix is to reconnect — which
              the user cannot guess from an empty calendar.
            */}
            {connection.lastError ? (
              <p className="mt-1 text-xs text-error">
                {t("calendarFailing", { error: connection.lastError })}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="rounded-md border border-border-medium px-2 py-1 text-xs text-fg-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
            >
              {sync.isPending ? t("calendarSyncing") : t("calendarSyncNow")}
            </button>
            <a
              href="/api/calendar/google/connect"
              className="rounded-md border border-border-medium px-2 py-1 text-xs text-fg-primary transition-colors hover:bg-bg-tertiary"
            >
              {t("calendarReconnect")}
            </a>
            <button
              type="button"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="rounded-md px-2 py-1 text-xs text-error transition-colors hover:bg-error/10 disabled:opacity-50"
            >
              {t("calendarDisconnect")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * What the OAuth callback reported.
 *
 * Four outcomes, and they are not interchangeable. `cancelled` is a decision, not
 * a failure. `no_refresh` is the one worth spelling out: Google granted access
 * without a refresh token, which the callback refuses to store because it would
 * work for an hour and then die silently — the user needs to know to approve
 * everything on the consent screen.
 */
function OutcomeBanner({
  reason,
  onDismiss,
  t,
}: {
  reason: string;
  onDismiss: () => void;
  t: Translator;
}) {
  const key =
    reason === "connected"
      ? "calendarConnected"
      : reason === "cancelled"
        ? "calendarCancelled"
        : reason === "no_refresh"
          ? "calendarNoRefresh"
          : "calendarFailed";

  const good = reason === "connected";

  return (
    <div
      className={`mb-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${
        good
          ? "border-emerald-500/35 bg-emerald-500/10"
          : "border-amber-500/35 bg-amber-500/10"
      }`}
    >
      <p className="text-xs leading-snug text-fg-secondary">{t(key)}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismiss")}
        className="shrink-0 text-xs text-fg-tertiary"
      >
        ×
      </button>
    </div>
  );
}
