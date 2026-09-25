"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Check, Copy, Link2, Loader2, Mail, Trash2 } from "~/components/ui/icons";
import { useToast } from "~/components/providers/ToastProvider";
import { useSettingsSave } from "~/components/settings/ledger/Ledger";
import {
  PermissionGrid,
  usePermissionSummary,
} from "~/components/orgs/PermissionGrid";
import {
  PERMISSION_FLAG_KEYS,
  TEMPLATE_ROLE_ORDER,
  baseRoleForFlags,
  flagsBeyond,
  flagsForRole,
  pickPermissionFlags,
  sameFlags,
  type MemberPermissionFlags,
  type OrgRole,
} from "~/lib/permissions";
import { api } from "~/trpc/react";

type Translator = (key: string, values?: Record<string, unknown>) => string;

export interface CustomRoleOption extends MemberPermissionFlags {
  id: number;
  name: string;
}

/** "builtin:member" or "custom:12". */
type TemplateKey = `builtin:${OrgRole}` | `custom:${number}`;

const USE_OPTIONS = [1, 5, 10, 25, 100] as const;
const EXPIRY_OPTIONS = [1, 7, 30] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmails(input: string): string[] {
  const parts = input
    .split(/[\n,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v && v !== "email");
  return Array.from(new Set(parts)).filter((v) => EMAIL_PATTERN.test(v));
}

/**
 * Tick exactly what someone may do, then hand it over — by email, or as a link
 * or code to share by any other means.
 *
 * Whatever is ticked here is what the person gets on joining: the server stores
 * the eight flags on the invite and writes them verbatim into the membership.
 * A template only pre-fills the ticks.
 */
export function InviteBuilder({
  organizationId,
  customRoles,
  callerFlags,
  callerIsRoleManager,
  prefill,
}: {
  organizationId: number;
  customRoles: readonly CustomRoleOption[];
  /** The inviter's own flags. Without role management they cap what may be granted. */
  callerFlags: MemberPermissionFlags;
  callerIsRoleManager: boolean;
  /** Set when someone is picked from the quick-invite list; `n` changes on every pick. */
  prefill?: { email: string; n: number };
}) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.workspace");
  const toast = useToast();
  const save = useSettingsSave();
  const utils = api.useUtils();
  const summarize = usePermissionSummary();

  const defaultTemplate: TemplateKey = "builtin:member";
  const [template, setTemplate] = useState<TemplateKey>(defaultTemplate);
  const [flags, setFlags] = useState<MemberPermissionFlags>(() =>
    capTo(flagsForRole("member")),
  );
  const [mode, setMode] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [maxUses, setMaxUses] = useState<number>(1);
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [justCreated, setJustCreated] = useState<{ url: string; code: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (prefill) {
      setEmail(prefill.email);
      setMode("email");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `n` is the trigger
  }, [prefill?.n]);

  /** The flags this inviter cannot hand out. */
  const lockedKeys = useMemo(
    () =>
      callerIsRoleManager
        ? []
        : PERMISSION_FLAG_KEYS.filter((key) => !callerFlags[key]),
    [callerFlags, callerIsRoleManager],
  );

  function capTo(next: MemberPermissionFlags): MemberPermissionFlags {
    if (callerIsRoleManager) return next;
    const capped = { ...next };
    for (const key of PERMISSION_FLAG_KEYS) if (!callerFlags[key]) capped[key] = false;
    return capped;
  }

  const templateFlags = (key: TemplateKey): MemberPermissionFlags => {
    if (key.startsWith("builtin:")) return flagsForRole(key.slice(8));
    const role = customRoles.find((r) => `custom:${r.id}` === key);
    return role ? pickPermissionFlags(role) : flagsForRole("guest");
  };

  const pickTemplate = (key: TemplateKey) => {
    setTemplate(key);
    setFlags(capTo(templateFlags(key)));
  };

  // A custom role that was deleted while selected falls back to Member.
  useEffect(() => {
    if (template.startsWith("custom:") && !customRoles.some((r) => `custom:${r.id}` === template)) {
      setTemplate(defaultTemplate);
      setFlags(capTo(flagsForRole("member")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the role list
  }, [customRoles]);

  const customRole = template.startsWith("custom:")
    ? customRoles.find((r) => `custom:${r.id}` === template)
    : undefined;
  const templateRole: OrgRole = template.startsWith("builtin:")
    ? (template.slice(8) as OrgRole)
    : "member";
  const edited = !sameFlags(flags, templateFlags(template));
  const role = baseRoleForFlags(templateRole, flags);
  // The custom role's name only describes the invite while its ticks are intact.
  const displayRole = customRole && !edited ? customRole.name : null;
  const grant = { role, displayRole, permissions: flags };
  const grantedCount = PERMISSION_FLAG_KEYS.filter((key) => flags[key]).length;
  const exceeds = flagsBeyond(flags, callerFlags).length > 0 && !callerIsRoleManager;

  const roleName = (r: OrgRole) => t(`roles.${r === "worker" ? "member" : r}`);
  const resultingLabel = displayRole ?? roleName(role);

  const invalidateInvites = () =>
    Promise.all([
      utils.organization.getInvites.invalidate(),
      utils.organization.getInviteHistory.invalidate(),
    ]);

  const inviteMember = api.organization.inviteMember.useMutation();
  const createLink = api.organization.createInviteLink.useMutation();
  const revokeLink = api.organization.revokeInviteLink.useMutation({
    onSuccess: () => {
      toast.success(t("inviteBuilder.linkRevoked"));
      void utils.organization.listInviteLinks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const { data: links } = api.organization.listInviteLinks.useQuery(
    { organizationId },
    { retry: false, refetchOnWindowFocus: false },
  );

  const sendOne = async (address: string) => {
    const result = await inviteMember.mutateAsync({ organizationId, email: address, ...grant });
    return result;
  };

  const handleSend = () => {
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      toast.error(t("inviteBuilder.invalidEmail"));
      return;
    }
    void save.run(async () => {
      try {
        const result = await sendOne(address);
        if (result.emailSent) {
          toast.success(t("inviteBuilder.emailSent", { email: result.email }));
        } else {
          toast.error(t("inviteBuilder.emailFailed", { email: result.email }));
        }
        setEmail("");
        await invalidateInvites();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("inviteBuilder.sendFailed"));
        throw e;
      }
    });
  };

  const handleBulk = () => {
    const emails = parseEmails(bulkInput);
    if (emails.length === 0) {
      toast.error(t("members.bulkInviteNoValidEmails"));
      return;
    }
    void save.run(async () => {
      let sent = 0;
      let failed = 0;
      let undelivered = 0;
      for (const address of emails) {
        try {
          const result = await sendOne(address);
          sent += 1;
          if (!result.emailSent) undelivered += 1;
        } catch {
          failed += 1;
        }
      }
      await invalidateInvites();
      if (sent > 0) {
        setBulkInput("");
        toast.success(t("members.bulkInviteSent", { count: sent }));
      }
      if (failed > 0) toast.error(t("members.bulkInvitePartial", { count: failed }));
      if (undelivered > 0) toast.error(t("inviteBuilder.bulkUndelivered", { count: undelivered }));
      if (sent === 0) throw new Error("bulk invite failed");
    });
  };

  const handleCreateLink = () => {
    void save.run(async () => {
      try {
        const link = await createLink.mutateAsync({
          organizationId,
          ...grant,
          maxUses,
          expiresInDays,
        });
        setJustCreated({ url: link.url, code: link.code });
        toast.success(t("inviteBuilder.linkCreated"));
        await utils.organization.listInviteLinks.invalidate();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("inviteBuilder.linkFailed"));
        throw e;
      }
    });
  };

  const copy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      toast.error(t("inviteBuilder.copyFailed"));
    }
  };

  const chip = (key: TemplateKey, label: string, disabled = false) => {
    const active = template === key;
    return (
      <button
        key={key}
        type="button"
        disabled={disabled}
        aria-pressed={active}
        onClick={() => pickTemplate(key)}
        className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? "border-accent-primary/50 bg-accent-primary/10 text-accent-primary"
            : "border-border-light text-fg-secondary hover:border-accent-primary/35 hover:text-fg-primary"
        }`}
      >
        {label}
      </button>
    );
  };

  const tab = (value: "email" | "link", icon: React.ReactNode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
        mode === value
          ? "bg-bg-primary text-fg-primary shadow-sm"
          : "text-fg-tertiary hover:text-fg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const inputClass =
    "min-w-0 flex-1 rounded-md border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] text-fg-primary outline-none transition-colors placeholder:text-fg-quaternary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30";
  const primaryButton =
    "flex items-center justify-center gap-1.5 rounded-md bg-accent-primary px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
  const selectClass =
    "rounded-md border border-border-medium bg-bg-secondary px-2 py-1.5 text-[13px] text-fg-primary outline-none focus:border-accent-primary";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-light p-4">
      <div>
        <p className="text-[13.5px] font-semibold text-fg-primary">{t("inviteBuilder.title")}</p>
        <p className="mt-0.5 text-xs text-fg-tertiary">{t("inviteBuilder.subtitle")}</p>
      </div>

      {/* 1. Start from a template */}
      <div>
        <p className="mb-2 text-xs font-medium text-fg-tertiary">{t("inviteBuilder.startFrom")}</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_ROLE_ORDER.map((r) =>
            chip(`builtin:${r}`, roleName(r), r === "admin" && !callerIsRoleManager),
          )}
          {customRoles.map((r) =>
            chip(
              `custom:${r.id}`,
              r.name,
              !callerIsRoleManager && flagsBeyond(pickPermissionFlags(r), callerFlags).length > 0,
            ),
          )}
        </div>
      </div>

      {/* 2. Tick exactly what they get */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-fg-tertiary">{t("inviteBuilder.permissions")}</p>
          <p className="text-[11.5px] text-fg-tertiary">
            {t("inviteBuilder.joinsAs", { role: resultingLabel, count: grantedCount })}
            {edited ? ` · ${t("inviteBuilder.edited")}` : ""}
          </p>
        </div>
        <PermissionGrid
          value={flags}
          onChange={setFlags}
          lockedKeys={lockedKeys}
          lockedHint={t("inviteBuilder.lockedHint")}
        />
        {role === "admin" && grantedCount < PERMISSION_FLAG_KEYS.length ? (
          <p className="mt-2 text-[11.5px] text-fg-tertiary">{t("inviteBuilder.adminNote")}</p>
        ) : null}
      </div>

      {/* 3. Deliver */}
      <div className="flex flex-col gap-3">
        <div role="tablist" className="flex w-fit gap-1 rounded-md bg-bg-tertiary p-1">
          {tab("email", <Mail size={13} />, t("inviteBuilder.byEmail"))}
          {tab("link", <Link2 size={13} />, t("inviteBuilder.byLink"))}
        </div>

        {mode === "email" ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                aria-label={t("members.emailPlaceholder")}
                placeholder={t("members.emailPlaceholder")}
                className={inputClass}
              />
              <button
                type="button"
                disabled={!email.trim() || inviteMember.isPending || exceeds}
                onClick={handleSend}
                className={primaryButton}
              >
                {inviteMember.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                {t("inviteBuilder.sendInvitation")}
              </button>
            </div>
            <p className="text-[11.5px] text-fg-tertiary">{t("inviteBuilder.emailHint")}</p>

            <button
              type="button"
              onClick={() => setBulkOpen((v) => !v)}
              className="w-fit text-xs font-medium text-fg-tertiary transition hover:text-fg-secondary"
            >
              {bulkOpen ? t("inviteBuilder.hideBulk") : t("inviteBuilder.showBulk")}
            </button>
            {bulkOpen ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  aria-label={t("members.bulkInviteLabel")}
                  placeholder={t("members.bulkInvitePlaceholder")}
                  className="min-h-[72px] w-full resize-y rounded-md border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] text-fg-primary outline-none transition-colors placeholder:text-fg-quaternary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30"
                />
                <button
                  type="button"
                  disabled={!bulkInput.trim() || inviteMember.isPending || exceeds}
                  onClick={handleBulk}
                  className={`${primaryButton} w-fit`}
                >
                  {t("members.bulkInviteAction")}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-fg-tertiary">
                {t("inviteBuilder.uses")}
                <select
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                  className={selectClass}
                >
                  {USE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {t("inviteBuilder.usesOption", { count: n })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-tertiary">
                {t("inviteBuilder.expires")}
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  className={selectClass}
                >
                  {EXPIRY_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {t("inviteBuilder.daysOption", { count: n })}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={createLink.isPending || exceeds}
                onClick={handleCreateLink}
                className={primaryButton}
              >
                {createLink.isPending ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                {t("inviteBuilder.createLink")}
              </button>
            </div>
            <p className="text-[11.5px] text-fg-tertiary">{t("inviteBuilder.linkHint")}</p>

            {justCreated ? (
              <div className="flex flex-col gap-2 rounded-lg border border-accent-primary/25 bg-accent-primary/5 p-3">
                <CopyRow
                  label={t("inviteBuilder.link")}
                  value={justCreated.url}
                  copied={copied === "new-url"}
                  onCopy={() => void copy(justCreated.url, "new-url")}
                  copyLabel={t("inviteBuilder.copy")}
                  copiedLabel={t("inviteBuilder.copied")}
                />
                <CopyRow
                  label={t("inviteBuilder.code")}
                  value={justCreated.code}
                  mono
                  copied={copied === "new-code"}
                  onCopy={() => void copy(justCreated.code, "new-code")}
                  copyLabel={t("inviteBuilder.copy")}
                  copiedLabel={t("inviteBuilder.copied")}
                />
                <p className="text-[11.5px] text-fg-tertiary">{t("inviteBuilder.codeHint")}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {links?.length ? (
        <div>
          <p className="mb-2 text-xs font-medium text-fg-tertiary">{t("inviteBuilder.activeLinks")}</p>
          <ul className="flex flex-col">
            {links.map((link, index) => (
              <li
                key={link.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${
                  index > 0 ? "border-t border-border-light" : ""
                }`}
              >
                <span className="text-[13px] font-medium text-fg-secondary">
                  {link.displayRole ?? roleName(link.role)}
                </span>
                <span className="text-xs text-fg-tertiary">
                  {summarize(link.permissions, t("inviteBuilder.viewOnly"))}
                </span>
                <span className="text-[11px] text-fg-quaternary">
                  {t("inviteBuilder.usedOf", { used: link.usedCount, max: link.maxUses })} ·{" "}
                  {t("members.expiresOn", { date: new Date(link.expiresAt).toLocaleDateString() })}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={t("inviteBuilder.copyLink")}
                  title={t("inviteBuilder.copyLink")}
                  onClick={() => void copy(link.url, `link-${link.id}`)}
                  className="rounded-sm p-1 text-fg-tertiary transition hover:text-fg-primary"
                >
                  {copied === `link-${link.id}` ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  aria-label={t("inviteBuilder.revoke")}
                  title={t("inviteBuilder.revoke")}
                  disabled={revokeLink.isPending}
                  onClick={() =>
                    void save.run(() => revokeLink.mutateAsync({ organizationId, linkId: link.id }))
                  }
                  className="rounded-sm p-1 text-fg-tertiary transition hover:text-error disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CopyRow({
  label,
  value,
  mono,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="w-12 flex-none text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </span>
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={label}
        className={`min-w-0 flex-1 rounded-md border border-border-light bg-bg-primary px-2 py-1 text-[12.5px] text-fg-primary outline-none ${
          mono ? "font-mono tracking-wider" : ""
        }`}
      />
      <button
        type="button"
        onClick={onCopy}
        className="flex w-fit items-center gap-1 rounded-sm border border-border-medium px-2.5 py-1 text-xs font-medium text-fg-primary transition hover:bg-bg-tertiary"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}
