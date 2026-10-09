"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ChatDialog } from "~/components/chat/ChatDialog";
import { Check, Copy, Link2, Loader2, Mail, UserPlus } from "~/components/ui/icons";
import { PERMISSION_DISPLAY_ORDER, usePermissionLabel } from "~/components/orgs/PermissionGrid";
import { useToast } from "~/components/providers/ToastProvider";
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
import { InviteePreview, useInviteeLookup } from "~/components/orgs/InviteePreview";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { Tick } from "./TeamPerson";
import { TEAM_EYEBROW, TEAM_PRIMARY_BUTTON, teamPill, type CustomRole } from "./teamUi";

/** "builtin:member" or "custom:12". */
type TemplateKey = `builtin:${OrgRole}` | `custom:${number}`;

const USE_OPTIONS = [1, 5, 10, 25, 100] as const;
const EXPIRY_OPTIONS = [1, 7, 30] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invite people, in the Team page's dialog chrome.
 *
 * The same contract as `InviteBuilder` in settings: whatever is ticked is what
 * the person gets on joining — the server stores the eight flags on the invite
 * and writes them verbatim into the membership. A template only pre-fills the
 * ticks, and an inviter without role management can't hand out a flag they
 * don't hold themselves (the server enforces that too).
 */
export function TeamInviteDialog({
  organizationId,
  organizationName,
  customRoles,
  callerFlags,
  callerIsRoleManager,
  onCopy,
  copiedId,
  onClose,
}: {
  organizationId: number;
  organizationName: string;
  customRoles: readonly CustomRole[];
  callerFlags: MemberPermissionFlags;
  callerIsRoleManager: boolean;
  onCopy: (value: string, id: string, message: string) => void;
  copiedId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("team");
  const tRoles = useTranslations("settings.workspace.roles");
  const toast = useToast();
  const utils = api.useUtils();
  const label = usePermissionLabel();

  const capTo = (next: MemberPermissionFlags): MemberPermissionFlags => {
    if (callerIsRoleManager) return next;
    const capped = { ...next };
    for (const key of PERMISSION_FLAG_KEYS) if (!callerFlags[key]) capped[key] = false;
    return capped;
  };

  const [template, setTemplate] = useState<TemplateKey>("builtin:member");
  const [flags, setFlags] = useState<MemberPermissionFlags>(() => capTo(flagsForRole("member")));
  const [mode, setMode] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState(false);
  const [maxUses, setMaxUses] = useState<number>(10);
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [created, setCreated] = useState<{ url: string; code: string } | null>(null);

  const lockedKeys = useMemo(
    () => (callerIsRoleManager ? [] : PERMISSION_FLAG_KEYS.filter((key) => !callerFlags[key])),
    [callerFlags, callerIsRoleManager],
  );

  const templateFlags = (key: TemplateKey): MemberPermissionFlags => {
    if (key.startsWith("builtin:")) return flagsForRole(key.slice(8));
    const role = customRoles.find((r) => `custom:${r.id}` === key);
    return role ? pickPermissionFlags(role) : flagsForRole("guest");
  };

  const customRole = template.startsWith("custom:")
    ? customRoles.find((r) => `custom:${r.id}` === template)
    : undefined;
  const templateRole: OrgRole = template.startsWith("builtin:") ? (template.slice(8) as OrgRole) : "member";
  const edited = !sameFlags(flags, capTo(templateFlags(template)));
  const role = baseRoleForFlags(templateRole, flags);
  const displayRole = customRole && !edited ? customRole.name : null;
  const grant = { role, displayRole, permissions: flags };
  const grantedCount = PERMISSION_FLAG_KEYS.filter((key) => flags[key]).length;
  const resulting = edited ? t("customLabel") : (displayRole ?? tRoles(templateRole === "worker" ? "member" : templateRole));

  const inviteMember = api.organization.inviteMember.useMutation();
  const invitee = useInviteeLookup(organizationId, email);
  const createLink = api.organization.createInviteLink.useMutation();

  const send = async () => {
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setEmailErr(true);
      return;
    }
    try {
      const result = await inviteMember.mutateAsync({ organizationId, email: address, ...grant });
      if (result.emailSent) toast.success(t("invitationSent", { email: result.email }));
      else toast.error(t("inviteEmailFailed", { email: result.email }));
      setEmail("");
      await utils.organization.getInvites.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const makeLink = async () => {
    try {
      const link = await createLink.mutateAsync({ organizationId, ...grant, maxUses, expiresInDays });
      setCreated({ url: link.url, code: link.code });
      toast.success(t("linkCreated"));
      await utils.organization.listInviteLinks.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const chip = (key: TemplateKey, text: string, disabled: boolean) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      aria-pressed={template === key && !edited}
      onClick={() => {
        setTemplate(key);
        setFlags(capTo(templateFlags(key)));
      }}
      className={cn(
        "h-[30px] rounded-full border px-3 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        teamPill(template === key && !edited),
      )}
    >
      {text}
    </button>
  );

  const option = (on: boolean, text: string, onPick: () => void, wide = false) => (
    <button
      key={text}
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        "h-7 rounded-full border text-[12.5px] font-medium tabular-nums transition-colors",
        wide ? "px-3" : "min-w-10 px-2.5",
        teamPill(on),
      )}
    >
      {text}
    </button>
  );

  const copyRow = (rowLabel: string, value: string, id: string, mono: boolean, message: string) => {
    const copied = copiedId === id;
    return (
      <div className="flex items-center gap-2.5">
        <span className="w-11 flex-none text-[11px] font-medium tracking-[0.14em] text-tui-ink3 uppercase">{rowLabel}</span>
        <span
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-tui-ink/16 bg-tui-bg px-3 text-[13px]",
            mono && "font-mono",
          )}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => onCopy(value, id, message)}
          className="kairos-tap flex h-8 items-center gap-1.5 rounded-full border border-tui-ink/16 bg-transparent px-3 text-[12.5px] text-tui-ink transition-colors hover:bg-tui-accent/6"
        >
          {copied ? <Check size={12} className="text-tui-ok" /> : <Copy size={12} className="text-tui-ink2" />}
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
    );
  };

  return (
    <ChatDialog
      icon={<UserPlus size={17} />}
      eyebrow={organizationName}
      title={t("inviteTitle")}
      sub={t("inviteSub")}
      foot={t("inviteFoot")}
      cancelLabel={t("done")}
      closeLabel={t("close")}
      onDismiss={onClose}
      widthClass="w-[620px]"
    >
      <div className="flex min-h-0 flex-col gap-[22px] overflow-y-auto px-5 pt-[22px] sm:px-[26px]">
        <div className="flex flex-col gap-2.5">
          <span className={TEAM_EYEBROW}>{t("startFrom")}</span>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_ROLE_ORDER.map((r) => chip(`builtin:${r}`, tRoles(r), r === "admin" && !callerIsRoleManager))}
            {customRoles.map((r) =>
              chip(
                `custom:${r.id}`,
                r.name,
                !callerIsRoleManager && flagsBeyond(pickPermissionFlags(r), callerFlags).length > 0,
              ),
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline">
            <span className={cn(TEAM_EYEBROW, "flex-1")}>{t("theyCan")}</span>
            <span className="text-[12.5px] text-tui-ink2">{t("joinsAs", { role: resulting, count: grantedCount })}</span>
          </div>
          <div className="-mx-2 grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
            {PERMISSION_DISPLAY_ORDER.map((key) => {
              const locked = lockedKeys.includes(key);
              return (
                <Tick
                  key={key}
                  label={label(key)}
                  on={flags[key]}
                  locked={locked}
                  dimWhenLocked
                  title={locked ? t("lockedTitle") : undefined}
                  onToggle={() => setFlags({ ...flags, [key]: !flags[key] })}
                />
              );
            })}
          </div>
          {lockedKeys.length > 0 ? <span className="text-[12.5px] text-tui-ink3">{t("lockedHint")}</span> : null}
        </div>

        <div className="flex flex-col gap-3.5 border-t border-tui-ink/8 pt-[18px]">
          <div role="tablist" className="flex gap-1.5">
            {(
              [
                ["email", t("byEmail"), <Mail key="m" size={13} />],
                ["link", t("byLink"), <Link2 key="l" size={13} />],
              ] as const
            ).map(([id, text, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={cn(
                  "flex h-8 items-center gap-[7px] rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                  teamPill(mode === id),
                )}
              >
                {icon}
                {text}
              </button>
            ))}
          </div>

          {mode === "email" ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex h-[42px] flex-1 items-center gap-2.5 rounded-lg border border-tui-ink/16 bg-tui-bg px-3.5">
                  <Mail size={14} className="flex-none text-tui-ink3" />
                  <input
                    type="email"
                    inputMode="email"
                    data-autofocus
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailErr(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !invitee.blocked) void send();
                    }}
                    placeholder="name@company.com"
                    aria-label={t("byEmail")}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-tui-ink outline-none placeholder:text-tui-ink3"
                  />
                </label>
                <button
                  type="button"
                  disabled={!email.trim() || inviteMember.isPending || invitee.blocked}
                  onClick={() => void send()}
                  className={cn(TEAM_PRIMARY_BUTTON, "h-[42px] px-[18px]")}
                >
                  {inviteMember.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                  {t("sendInvitation")}
                </button>
              </div>
              {emailErr ? <span className="text-[12.5px] text-tui-danger">{t("badEmail")}</span> : null}
              <InviteePreview email={email} lookup={invitee.result} loading={invitee.loading} />
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="w-16 text-[12.5px] text-tui-ink3">{t("uses")}</span>
                {USE_OPTIONS.map((n) => option(maxUses === n, String(n), () => setMaxUses(n)))}
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="w-16 text-[12.5px] text-tui-ink3">{t("expiresLabel")}</span>
                {EXPIRY_OPTIONS.map((n) =>
                  option(expiresInDays === n, t("days", { count: n }), () => setExpiresInDays(n), true),
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={createLink.isPending}
                  onClick={() => void makeLink()}
                  className={cn(TEAM_PRIMARY_BUTTON, "h-[34px]")}
                >
                  {createLink.isPending ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                  {t("createLink")}
                </button>
              </div>
              {created ? (
                <div className="team-rise flex flex-col gap-2.5 rounded-lg border border-tui-accent/45 bg-tui-accent/6 p-3.5">
                  {copyRow(t("link"), created.url, "new-url", false, t("linkCopied"))}
                  {copyRow(t("code"), created.code, "new-code", true, t("codeCopied"))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </ChatDialog>
  );
}
