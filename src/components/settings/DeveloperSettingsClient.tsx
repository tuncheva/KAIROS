"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useEntitlement } from "~/hooks/useEntitlements";
import { api } from "~/trpc/react";

import {
  LedgerAction,
  LedgerError,
  LedgerGroup,
  LedgerInput,
  LedgerSection,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

/**
 * Settings → Developer. API keys and outbound webhooks.
 *
 * **Visible on every plan, including Free.** Every procedure behind this page
 * throws `FORBIDDEN` without `entitlements.apiAccess`, so the tab has to explain
 * the gate rather than error into it — a hidden tab makes the capability
 * undiscoverable, and a tab that 403s reads as a bug. It is a shopfront, not a
 * trap.
 *
 * Both panels share one constraint that drives their design: they hand the user a
 * secret exactly once. A key's plaintext and a webhook's signing secret exist
 * only in the response that created them; nothing stores either, and nothing can
 * recover them. So both have a show-once state that must be visually distinct
 * from the list it sits above, or someone will scroll past the only copy.
 */
export function DeveloperSettingsClient() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.developer");
  const crumb = useSectionCrumb("developer");

  const hasApiAccess = useEntitlement("apiAccess");

  return (
    <LedgerSection
      sectionId="developer"
      crumb={crumb}
      title={t("title")}
      subtitle={t("subtitle")}
    >
      {hasApiAccess ? (
        <>
          <KeysGroup t={t} />
          <WebhooksGroup t={t} />
        </>
      ) : (
        <UpgradeGroup t={t} />
      )}
    </LedgerSection>
  );
}

/**
 * What Free sees.
 *
 * Describes the capability rather than hiding it, and does not pretend to be a
 * disabled version of the real panel — a greyed-out form the user cannot submit
 * is more frustrating than a plain explanation of what the tier includes.
 */
function UpgradeGroup({ t }: { t: Translator }) {
  const rows: LedgerRow[] = ["gatedKeys", "gatedWebhooks", "gatedLog"].map((key) => ({
    id: key,
    title: t(key),
    dim: true,
  }));

  return (
    <LedgerGroup
      label={t("gatedTitle")}
      hint={t("gatedDescription")}
      note={t("gatedFooter")}
      rows={rows}
    />
  );
}

/** The one moment a secret exists. Loud on purpose. */
function ShowOnce({
  title,
  hint,
  value,
  footer,
  onDismiss,
  copyLabel,
  copiedLabel,
  dismissLabel,
}: {
  title: string;
  hint: string;
  value: string;
  footer?: string;
  onDismiss: () => void;
  copyLabel?: string;
  copiedLabel?: string;
  dismissLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mb-3 rounded-lg border border-accent-primary/40 bg-accent-primary/[0.08] p-3">
      <p className="text-[13px] font-semibold text-fg-primary">{title}</p>
      <p className="mt-0.5 text-xs text-fg-tertiary">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-bg-secondary px-2 py-1.5 font-mono text-xs text-fg-primary">
          {value}
        </code>
        {copyLabel ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(value);
              setCopied(true);
            }}
            className="shrink-0 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-semibold text-white"
          >
            {copied ? (copiedLabel ?? copyLabel) : copyLabel}
          </button>
        ) : null}
      </div>
      {footer ? (
        <p className="mt-2 font-mono text-[11px] text-fg-quaternary">{footer}</p>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs text-fg-tertiary underline"
      >
        {dismissLabel}
      </button>
    </div>
  );
}

function KeysGroup({ t }: { t: Translator }) {
  const utils = api.useUtils();
  const save = useSettingsSave();
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keys = api.integration.keys.useQuery(undefined, { retry: false });
  const invalidate = () => void utils.integration.keys.invalidate();

  const create = api.integration.createKey.useMutation({
    onSuccess: (result) => {
      // The only moment this value is ever available.
      setMinted(result.plaintext);
      setLabel("");
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const revoke = api.integration.revokeKey.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });

  const rows = keys.data ?? [];

  const createRow: LedgerRow = {
    id: "createKey",
    title: t("createKey"),
    desc: error ? <LedgerError>{error}</LedgerError> : undefined,
    descText: error ?? "",
    control: (
      <>
        <LedgerInput
          value={label}
          onChange={setLabel}
          ariaLabel={t("createKey")}
          placeholder={t("keyLabelPlaceholder")}
          maxLength={80}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) {
              void save.run(() => create.mutateAsync({ label: label.trim() }));
            }
          }}
        />
        <LedgerAction
          disabled={create.isPending || !label.trim()}
          onClick={() => void save.run(() => create.mutateAsync({ label: label.trim() }))}
        >
          {create.isPending ? t("creating") : t("createKey")}
        </LedgerAction>
      </>
    ),
  };

  const list = (
    <>
      {minted ? (
        <ShowOnce
          title={t("copyNow")}
          hint={t("copyNowHint")}
          value={minted}
          copyLabel={t("copy")}
          copiedLabel={t("copied")}
          dismissLabel={t("dismiss")}
          onDismiss={() => setMinted(null)}
        />
      ) : null}

      {keys.isLoading ? (
        <p className="text-sm text-fg-tertiary">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-tertiary">{t("keysEmpty")}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((key, index) => (
            <li
              key={key.id}
              // Revoked rows are kept and dimmed rather than removed: after a
              // leak the first question is "was it used, and when did we stop
              // trusting it", and a deleted row answers neither half.
              className={`flex items-center justify-between gap-3 py-3 ${
                index > 0 ? "border-t border-border-light" : ""
              } ${key.revokedAt ? "opacity-60" : ""}`}
            >
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-fg-primary">
                  {key.label}
                  {key.revokedAt ? (
                    <span className="ml-2 text-xs font-normal text-error">
                      {t("revoked")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 font-mono text-xs text-fg-quaternary">
                  {key.prefix}…{" · "}
                  {key.lastUsedAt
                    ? t("lastUsed", {
                        when: new Date(key.lastUsedAt).toLocaleDateString(),
                      })
                    : t("neverUsed")}
                </p>
              </div>
              {key.revokedAt ? null : (
                <LedgerAction
                  danger
                  disabled={revoke.isPending}
                  onClick={() =>
                    void save.run(() => revoke.mutateAsync({ keyId: key.id }))
                  }
                >
                  {t("revoke")}
                </LedgerAction>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <LedgerGroup
      label={t("keysTitle")}
      hint={t("keysDescription")}
      rows={[createRow]}
      block={list}
    />
  );
}

function WebhooksGroup({ t }: { t: Translator }) {
  const utils = api.useUtils();
  const save = useSettingsSave();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<number | null>(null);

  const hooks = api.integration.webhooks.useQuery(undefined, { retry: false });
  const invalidate = () => void utils.integration.webhooks.invalidate();

  const create = api.integration.createWebhook.useMutation({
    onSuccess: (result) => {
      setSecret(result.secret);
      setUrl("");
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const update = api.integration.updateWebhook.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const remove = api.integration.deleteWebhook.useMutation({ onSuccess: invalidate });

  const rows = hooks.data ?? [];

  const addRow: LedgerRow = {
    id: "addWebhook",
    title: t("addWebhook"),
    desc: error ? <LedgerError>{error}</LedgerError> : t("hooksUrlRule"),
    descText: t("hooksUrlRule"),
    control: (
      <>
        <LedgerInput
          value={url}
          onChange={setUrl}
          ariaLabel={t("addWebhook")}
          placeholder="https://hooks.example.com/kairos"
          maxLength={2000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim()) {
              void save.run(() => create.mutateAsync({ url: url.trim(), events: [] }));
            }
          }}
        />
        <LedgerAction
          disabled={create.isPending || !url.trim()}
          onClick={() =>
            void save.run(() => create.mutateAsync({ url: url.trim(), events: [] }))
          }
        >
          {create.isPending ? t("creating") : t("addWebhook")}
        </LedgerAction>
      </>
    ),
  };

  const list = (
    <>
      {secret ? (
        <ShowOnce
          title={t("secretNow")}
          // The receiver needs the recipe as well as the value. Publishing it
          // next to the secret is the difference between a verified webhook and
          // a signature header nobody checks.
          hint={t("secretHint")}
          value={secret}
          footer='X-Kairos-Signature: sha256=HMAC_SHA256(secret, timestamp + "." + body)'
          dismissLabel={t("dismiss")}
          onDismiss={() => setSecret(null)}
        />
      ) : null}

      {hooks.isLoading ? (
        <p className="text-sm text-fg-tertiary">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-tertiary">{t("hooksEmpty")}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((hook, index) => (
            <li
              key={hook.id}
              className={`py-3 ${index > 0 ? "border-t border-border-light" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-fg-primary">
                    {hook.url}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-quaternary">
                    {hook.events ? hook.events : t("allEvents")}
                    {!hook.enabled ? ` · ${t("disabled")}` : ""}
                  </p>
                  {/*
                    Auto-disable needs explaining where it happened. Otherwise the
                    only account of why deliveries stopped lives in a server log
                    the user cannot read.
                  */}
                  {!hook.enabled && hook.failureCount > 0 ? (
                    <p className="mt-1 text-xs text-error">
                      {t("autoDisabled", { count: hook.failureCount })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <LedgerAction
                    disabled={update.isPending}
                    onClick={() =>
                      void save.run(() =>
                        update.mutateAsync({ id: hook.id, enabled: !hook.enabled }),
                      )
                    }
                  >
                    {hook.enabled ? t("disable") : t("enable")}
                  </LedgerAction>
                  <LedgerAction
                    onClick={() => setLogFor(logFor === hook.id ? null : hook.id)}
                  >
                    {t("log")}
                  </LedgerAction>
                  <LedgerAction
                    danger
                    disabled={remove.isPending}
                    onClick={() =>
                      void save.run(() => remove.mutateAsync({ id: hook.id }))
                    }
                  >
                    {t("delete")}
                  </LedgerAction>
                </div>
              </div>

              {logFor === hook.id ? <DeliveryLog id={hook.id} t={t} /> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <LedgerGroup
      label={t("hooksTitle")}
      hint={t("hooksDescription")}
      rows={[addRow]}
      block={list}
    />
  );
}

/**
 * Recent delivery attempts.
 *
 * Shows the attempt count and, for a 4xx, that it was deliberately not retried —
 * "the endpoint refused" and "we gave up" are different facts, and only one of
 * them is the product's fault.
 */
function DeliveryLog({ id, t }: { id: number; t: Translator }) {
  const log = api.integration.webhookDeliveries.useQuery(
    { webhookId: id, limit: 10 },
    { retry: false },
  );

  if (log.isLoading) {
    return <p className="mt-2 text-xs text-fg-tertiary">{t("loading")}</p>;
  }

  const rows = log.data ?? [];
  if (!rows.length) {
    return <p className="mt-2 text-xs text-fg-tertiary">{t("logEmpty")}</p>;
  }

  return (
    <ul className="mt-2 flex flex-col gap-1 border-t border-border-light pt-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-baseline gap-2 text-xs">
          <span className={`font-mono ${row.ok ? "text-fg-secondary" : "text-error"}`}>
            {row.statusCode ?? t("noResponse")}
          </span>
          <span className="min-w-0 flex-1 truncate text-fg-tertiary">
            {row.event}
            {row.attempts > 1 ? ` · ${t("attempts", { n: row.attempts })}` : ""}
            {!row.ok &&
            row.statusCode !== null &&
            row.statusCode >= 400 &&
            row.statusCode < 500 &&
            row.statusCode !== 429
              ? ` · ${t("notRetried")}`
              : ""}
          </span>
          <span className="shrink-0 text-fg-quaternary">
            {new Date(row.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
