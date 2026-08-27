"use client";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEntitlements } from "~/hooks/useEntitlements";
import { api } from "~/trpc/react";

import {
  LedgerAction,
  LedgerError,
  LedgerGroup,
  LedgerInput,
  LedgerSection,
  LedgerToggle,
  LedgerValue,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

export function SecuritySettingsClient() {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings.security");
  const crumb = useSectionCrumb("security");
  const save = useSettingsSave();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset PIN form state.
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [hint, setHint] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const { status } = useSession();
  const enabled = status === "authenticated";

  const utils = api.useUtils();

  const { data, isLoading } = api.settings.get.useQuery(undefined, {
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (data?.resetPinHint) setHint(data.resetPinHint);
  }, [data?.resetPinHint]);

  const updateSecurity = api.settings.updateSecurity.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
    },
  });

  const updateResetPin = api.settings.updateResetPin.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
      setPin("");
      setConfirmPin("");
      setPinError(null);
    },
    onError: (e) => {
      setPinError(e instanceof Error ? e.message : t("errors.updateResetPin"));
    },
  });

  const deleteAllData = api.settings.deleteAllData.useMutation();

  // Which formats this plan includes. The server refuses the rest with a 403, so
  // this only decides what to *offer* — a link that 403s would be worse than an
  // absent one.
  const { entitlements } = useEntitlements();
  const exportFormats = entitlements.exportFormats;

  const notesKeepUnlockedUntilClose = data?.notesKeepUnlockedUntilClose ?? false;
  const hasResetPin = data?.hasResetPin ?? false;

  const isBusy =
    isLoading ||
    updateSecurity.isPending ||
    updateResetPin.isPending ||
    deleteAllData.isPending;

  const onSignOut = async () => {
    await utils.settings.get.cancel();
    await signOut({ callbackUrl: "/" });
  };

  const onDeleteAccount = async () => {
    try {
      await deleteAllData.mutateAsync();
      await utils.settings.get.cancel();
      await signOut({ callbackUrl: "/" });
    } catch {
      // Surfaced through deleteAllData.error below.
    }
  };

  // The PIN is the one control on this page that still writes on a button.
  // Everything else has a single value that is either valid or unchanged; a PIN
  // is three fields that only mean something together, and committing one of
  // them the moment typing pauses would write half a secret.
  const submitPin = () => {
    if (!pin || !confirmPin) {
      setPinError(t("errors.pinRequired"));
      return;
    }
    void save.run(() => updateResetPin.mutateAsync({ pin, confirmPin, hint }));
  };

  const pinRows: LedgerRow[] = [
    {
      id: "pinStatus",
      title: t("status"),
      control: (
        <LedgerValue tone={hasResetPin ? "good" : "dim"}>
          {hasResetPin ? t("pinConfigured") : t("noPinConfigured")}
        </LedgerValue>
      ),
    },
    {
      id: "pin",
      title: t("newPin"),
      control: (
        <LedgerInput
          type="password"
          inputMode="numeric"
          value={pin}
          disabled={isBusy}
          ariaLabel={t("newPin")}
          onChange={(next) => {
            setPin(next);
            setPinError(null);
          }}
        />
      ),
    },
    {
      id: "confirmPin",
      title: t("confirmPin"),
      control: (
        <LedgerInput
          type="password"
          inputMode="numeric"
          value={confirmPin}
          disabled={isBusy}
          ariaLabel={t("confirmPin")}
          onChange={(next) => {
            setConfirmPin(next);
            setPinError(null);
          }}
        />
      ),
    },
    {
      id: "hint",
      title: t("hint"),
      control: (
        <LedgerInput
          value={hint}
          maxLength={200}
          disabled={isBusy}
          ariaLabel={t("hint")}
          placeholder={t("hintPlaceholder")}
          onChange={setHint}
        />
      ),
    },
    {
      id: "pinSave",
      title: t("saveResetPin"),
      desc: pinError ? <LedgerError>{pinError}</LedgerError> : undefined,
      descText: pinError ?? "",
      control: (
        <LedgerAction disabled={isBusy || updateResetPin.isPending} onClick={submitPin}>
          {updateResetPin.isPending ? t("saving") : t("saveResetPin")}
        </LedgerAction>
      ),
    },
  ];

  const dataRows: LedgerRow[] = [
    {
      id: "export",
      title: t("exportData"),
      desc: t("exportDataDesc"),
      // Plain anchors: the response carries Content-Disposition, so the browser
      // saves the file without any JavaScript involved.
      control: (
        <>
          {exportFormats.map((format) => (
            <LedgerAction key={format} href={`/api/export/${format}`}>
              {t(`export_${format}`)}
            </LedgerAction>
          ))}
        </>
      ),
    },
    {
      // Deliberately adjacent to Export. "Take a copy" and "destroy it" are the
      // two things a person wants in the same moment, and offering only the
      // second is how a product feels like a trap.
      id: "delete",
      title: t("deleteAccount"),
      danger: true,
      desc: deleteAllData.error ? (
        <LedgerError>{deleteAllData.error.message}</LedgerError>
      ) : (
        t("deleteAccountDesc")
      ),
      descText: t("deleteAccountDesc"),
      control: showDeleteConfirm ? (
        <>
          <LedgerAction danger disabled={isBusy} onClick={onDeleteAccount}>
            {t("confirm")}
          </LedgerAction>
          <LedgerAction disabled={isBusy} onClick={() => setShowDeleteConfirm(false)}>
            {t("cancel")}
          </LedgerAction>
        </>
      ) : (
        <LedgerAction danger disabled={isBusy} onClick={() => setShowDeleteConfirm(true)}>
          {t("deleteAccount")}
        </LedgerAction>
      ),
    },
  ];

  return (
    <LedgerSection
      sectionId="security"
      crumb={crumb}
      title={t("title")}
      subtitle={t("subtitle")}
    >
      <LedgerGroup
        label={t("groupNotes")}
        hint={t("groupNotesHint")}
        rows={[
          {
            id: "keepUnlocked",
            title: t("notesKeepUnlocked"),
            desc: updateSecurity.error ? (
              <LedgerError>{updateSecurity.error.message}</LedgerError>
            ) : (
              t("notesKeepUnlockedDesc")
            ),
            descText: t("notesKeepUnlockedDesc"),
            control: (
              <LedgerToggle
                checked={notesKeepUnlockedUntilClose}
                disabled={isBusy}
                label={t("notesKeepUnlocked")}
                onChange={(next) =>
                  void save.run(() =>
                    updateSecurity.mutateAsync({ notesKeepUnlockedUntilClose: next }),
                  )
                }
              />
            ),
          },
        ]}
      />

      <LedgerGroup label={t("resetPin")} hint={t("resetPinDesc")} rows={pinRows} />

      <LedgerGroup
        label={t("session")}
        hint={t("sessionDesc")}
        rows={[
          {
            id: "signOut",
            title: t("signOut"),
            control: (
              <LedgerAction disabled={isBusy} onClick={() => void onSignOut()}>
                {t("signOut")}
              </LedgerAction>
            ),
          },
        ]}
      />

      <LedgerGroup label={t("groupData")} hint={t("groupDataHint")} rows={dataRows} />
    </LedgerSection>
  );
}
