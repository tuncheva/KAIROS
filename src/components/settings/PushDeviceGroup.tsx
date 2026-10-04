"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { env } from "~/env";
import {
  detectPushState,
  isIOS,
  subscribeToPush,
  unsubscribeFromPush,
  type PushState,
} from "~/lib/pushClient";

import { LedgerAction, LedgerGroup, LedgerValue, type LedgerRow } from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

/**
 * "This device": lock-screen notifications for the browser or Home Screen app
 * the settings page is open in.
 *
 * It is per device rather than a switch on the account because a push
 * subscription *is* a device — enabling it on the phone says nothing about the
 * laptop. What reaches the device is still decided by the category switches
 * below; this only adds a second place for the same notifications to land.
 */
export function PushDeviceGroup() {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings.notifications");

  const status = api.notification.pushStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const subscribe = api.notification.pushSubscribe.useMutation();
  const unsubscribe = api.notification.pushUnsubscribe.useMutation();
  const test = api.notification.pushTest.useMutation();

  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const configured = status.data?.configured ?? false;
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  const refresh = useCallback(async () => {
    setState(await detectPushState(configured && !!publicKey));
  }, [configured, publicKey]);

  useEffect(() => {
    if (status.isSuccess) void refresh();
  }, [status.isSuccess, refresh]);

  // No `await` before `subscribeToPush`: iOS only shows the permission prompt
  // when the request is made in the same turn as the tap.
  const enable = () => {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    subscribeToPush(publicKey)
      .then((sub) => subscribe.mutateAsync(sub))
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        // Browsers fail here for reasons only the message explains (push
        // service disabled, key mismatch), so keep it out of the generic copy.
        // warn, not error: these are browser settings, not app bugs, and an
        // error would open the dev overlay over the message that explains them.
        console.warn("[push] enable failed", err);
        // Brave ships with Google's push service off, which every Chromium
        // browser needs; subscribing then fails with this exact message.
        const isBrave = "brave" in navigator;
        setError(
          reason === "denied"
            ? t("pushErrorDenied")
            : reason === "dismissed"
              ? null
              : /push service/i.test(reason)
                ? isBrave
                  ? t("pushErrorBrave")
                  : t("pushErrorService")
                : `${t("pushErrorGeneric")} (${reason})`,
        );
      })
      .finally(() => {
        setBusy(false);
        void refresh();
        void status.refetch();
      });
  };

  const disable = () => {
    setBusy(true);
    setError(null);
    unsubscribeFromPush()
      .then((endpoint) => (endpoint ? unsubscribe.mutateAsync({ endpoint }) : undefined))
      .catch(() => setError(t("pushErrorGeneric")))
      .finally(() => {
        setBusy(false);
        void refresh();
        void status.refetch();
      });
  };

  const sendTest = () => {
    setTestResult(null);
    test
      .mutateAsync({ title: t("pushTestTitle"), message: t("pushTestBody") })
      .then((r) => setTestResult(r.sent > 0 ? t("pushTestSent") : t("pushTestNone")))
      .catch(() => setTestResult(t("pushErrorGeneric")));
  };

  let desc: string;
  let control: React.ReactNode;

  switch (state) {
    case "unconfigured":
      desc = t("pushUnconfiguredDesc");
      control = <LedgerValue tone="dim">{t("pushUnavailable")}</LedgerValue>;
      break;
    case "needs-install":
      desc = t("pushInstallDesc");
      control = <LedgerValue tone="dim">{t("pushInstallFirst")}</LedgerValue>;
      break;
    case "unsupported":
      desc = t("pushUnsupportedDesc");
      control = <LedgerValue tone="dim">{t("pushUnavailable")}</LedgerValue>;
      break;
    case "denied":
      desc = isIOS() ? t("pushDeniedDescIos") : t("pushDeniedDesc");
      control = <LedgerValue tone="bad">{t("pushBlocked")}</LedgerValue>;
      break;
    case "on":
      desc = t("pushOnDesc");
      control = (
        <LedgerAction onClick={disable} disabled={busy}>
          {t("pushDisable")}
        </LedgerAction>
      );
      break;
    default:
      desc = t("pushOffDesc");
      control = (
        <LedgerAction onClick={enable} disabled={busy || state === null}>
          {t("pushEnable")}
        </LedgerAction>
      );
  }

  const rows: LedgerRow[] = [
    {
      id: "pushDevice",
      title: t("pushTitle"),
      desc: error ?? desc,
      descText: desc,
      keywords: "push iphone phone lock screen web push",
      control,
    },
  ];

  if (state === "on") {
    rows.push({
      id: "pushTest",
      title: t("pushTest"),
      desc: testResult ?? t("pushTestDesc"),
      descText: t("pushTestDesc"),
      control: (
        <LedgerAction onClick={sendTest} disabled={test.isPending}>
          {t("pushTestSend")}
        </LedgerAction>
      ),
    });
  }

  return <LedgerGroup label={t("groupPushTitle")} hint={t("groupPushDesc")} rows={rows} />;
}
