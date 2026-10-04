"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Check, KeyRound, Loader2, Lock, Plus } from "~/components/ui/icons";
import { OrgBadge } from "~/components/orgs/OrgBadge";
import { PERMISSION_DISPLAY_ORDER, usePermissionLabel } from "~/components/orgs/PermissionGrid";
import {
  PERMISSION_FLAG_KEYS,
  TEMPLATE_ROLE_ORDER,
  flagsForRole,
  type MemberPermissionFlags,
} from "~/lib/permissions";
import { cn } from "~/lib/utils";
import {
  ROLE_DESC_KEYS,
  TEAM_EYEBROW,
  TEAM_GHOST_BUTTON,
  TEAM_PANE,
  TEAM_PRIMARY_BUTTON,
  shownRole,
} from "./teamUi";

export interface FeaturedInvite {
  id: number;
  organizationId: number;
  orgName: string;
  orgImage: string | null;
  role: string;
  displayRole: string | null;
  inviterName: string | null;
  memberCount: number;
  createdAt: Date | string;
  permissions: MemberPermissionFlags;
}

const FIELD =
  "h-10 min-w-0 flex-1 rounded-lg border border-tui-ink/16 bg-tui-pane px-3 text-[14px] text-tui-ink outline-none placeholder:text-tui-ink3 focus:border-tui-accent/50";

/**
 * The middle pane for someone in no organization yet — a fresh sign-up, or
 * someone who just left their last one.
 *
 * The two ways in are the page's main actions, each with its field inline so
 * there's no dialog to open first. When an invitation is waiting it is
 * promoted over both, with exactly the ticks it would grant.
 */
export function TeamEmpty({
  userName,
  email,
  invite,
  onJoin,
  joining,
  onCreate,
  creating,
  onAccept,
  onDecline,
  busyInviteId,
}: {
  userName: string;
  email: string | null;
  invite: FeaturedInvite | null;
  onJoin: (code: string) => void;
  joining: boolean;
  onCreate: (name: string) => void;
  creating: boolean;
  onAccept: (invite: FeaturedInvite) => void;
  onDecline: (invite: FeaturedInvite) => void;
  busyInviteId: number | null;
}) {
  const t = useTranslations("team");
  const tRoles = useTranslations("settings.workspace.roles");
  const locale = useLocale();
  const label = usePermissionLabel();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [showPaths, setShowPaths] = useState(false);

  const codeOk = code.replace(/[^a-z0-9]/gi, "").length >= 6;

  const circles = (faces: { text: string; tone: "ghost" | "you" | "org" }[]) => (
    <div className="mb-[26px] flex items-center" aria-hidden="true">
      {faces.map((f, i) => (
        <span
          key={i}
          className={cn(
            "grid place-items-center rounded-full font-display first:ml-0",
            f.tone === "you"
              ? "z-[1] -ml-3 h-14 w-14 border border-tui-accent/45 bg-tui-accent/15 text-[24px] text-tui-accent"
              : f.tone === "org"
                ? "-ml-3 h-12 w-12 border border-tui-accent/45 bg-tui-pane text-[20px] text-tui-accent"
                : "-ml-3 h-12 w-12 border border-dashed border-tui-ink/16 bg-tui-pane text-[20px] text-tui-ink3",
          )}
        >
          {f.text}
        </span>
      ))}
    </div>
  );
  const me = (userName.trim() ? userName : (email ?? "?")).trim().charAt(0).toUpperCase();

  if (invite && !showPaths) {
    const role = invite.displayRole ?? tRoles(shownRole(invite.role));
    const sent = new Date(invite.createdAt).toLocaleDateString(locale, { month: "short", day: "numeric" });
    const meta = [
      role,
      invite.memberCount > 0 ? t("peopleCount", { count: invite.memberCount }) : null,
      invite.inviterName ? t("fromName", { name: invite.inviterName }) : null,
    ].filter(Boolean);
    const busy = busyInviteId === invite.id;

    return (
      <main className={cn(TEAM_PANE, "flex min-h-[520px] min-w-0 flex-col overflow-hidden")}>
        <div className="team-rise flex flex-1 flex-col items-center justify-center px-5 py-10 text-center sm:px-10">
          {circles([
            { text: "?", tone: "ghost" },
            { text: me, tone: "you" },
            { text: invite.orgName.charAt(0).toUpperCase(), tone: "org" },
          ])}
          <h2 className="m-0 font-display text-[clamp(30px,3.2vw,40px)] leading-[1.05] font-light tracking-[-0.02em] text-balance">
            {t("inviteHeadline", { org: invite.orgName })}
          </h2>
          <p className="m-0 mt-3 max-w-[46ch] text-[14.5px] text-pretty text-tui-ink2">
            {invite.inviterName
              ? t("inviteLede", { name: invite.inviterName, date: sent })
              : t("inviteLedeAnon", { date: sent })}
          </p>

          <div className="mt-7 flex w-full max-w-[560px] flex-col gap-4 rounded-xl border border-tui-accent/45 bg-tui-accent/6 p-[22px] text-left">
            <div className="flex items-center gap-3.5">
              <OrgBadge id={invite.organizationId} name={invite.orgName} image={invite.orgImage} size={48} rounded="rounded-xl" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-display text-[26px] leading-[1.1]">{invite.orgName}</span>
                <span className="text-[13px] text-tui-ink2">{meta.join(" · ")}</span>
              </span>
            </div>
            <div className="grid grid-cols-1 gap-x-[18px] gap-y-2 sm:grid-cols-2">
              {PERMISSION_DISPLAY_ORDER.map((key) => {
                const on = invite.permissions[key];
                return (
                  <span key={key} className={cn("flex items-center gap-2.5 text-[13px]", on ? "text-tui-ink" : "text-tui-ink3")}>
                    <span
                      className={cn(
                        "grid h-4 w-4 flex-none place-items-center rounded-[4px] border",
                        on ? "border-tui-accent/45 bg-tui-accent/15" : "border-tui-ink/16",
                      )}
                    >
                      {on ? <Check size={10} className="text-tui-accent" /> : null}
                    </span>
                    {label(key)}
                  </span>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onAccept(invite)}
                className={cn(TEAM_PRIMARY_BUTTON, "min-w-[140px] flex-1")}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                {t("acceptAndOpen", { org: invite.orgName })}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecline(invite)}
                className={cn(TEAM_GHOST_BUTTON, "min-w-[140px] flex-1")}
              >
                {t("decline")}
              </button>
            </div>
          </div>

          <p className="m-0 mt-[22px] flex flex-wrap items-center justify-center gap-1.5 text-[13px] text-tui-ink3">
            {t("notExpected")}
            <button
              type="button"
              onClick={() => setShowPaths(true)}
              className="border-0 bg-transparent p-0 font-medium text-tui-accent underline decoration-tui-accent/45 underline-offset-[3px]"
            >
              {t("otherWays")}
            </button>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={cn(TEAM_PANE, "flex min-h-[520px] min-w-0 flex-col overflow-hidden")}>
      <div className="team-rise flex flex-1 flex-col items-center justify-center px-5 py-10 text-center sm:px-10">
        {circles([
          { text: "?", tone: "ghost" },
          { text: "?", tone: "ghost" },
          { text: me, tone: "you" },
          { text: "?", tone: "ghost" },
          { text: "?", tone: "ghost" },
        ])}
        <h2 className="m-0 font-display text-[clamp(30px,3.2vw,40px)] leading-[1.05] font-light tracking-[-0.02em] text-balance">
          {t("emptyTitle")}
        </h2>
        <p className="m-0 mt-3 max-w-[46ch] text-[14.5px] text-pretty text-tui-ink2">{t("emptyBody")}</p>

        <div className="mt-[30px] grid w-full max-w-[680px] grid-cols-1 gap-3.5 text-left md:grid-cols-2">
          <form
            className="flex flex-col gap-3 rounded-[10px] border border-tui-ink/16 bg-tui-bg/55 p-[18px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (codeOk && !joining) onJoin(code.trim());
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-tui-accent/45 text-tui-accent">
                <KeyRound size={14} />
              </span>
              <span className="font-display text-[21px] leading-[1.1]">{t("haveCode")}</span>
            </div>
            <p className="m-0 text-[13px] leading-normal text-tui-ink2">{t("haveCodeBody")}</p>
            <div className="flex gap-2">
              <input
                id="team-empty-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="KX7-42QD"
                aria-label={t("joinWithCode")}
                autoComplete="off"
                spellCheck={false}
                maxLength={40}
                className={cn(FIELD, "font-mono tracking-[0.14em] uppercase")}
              />
              <button type="submit" disabled={!codeOk || joining} className={cn(TEAM_PRIMARY_BUTTON, "h-10")}>
                {joining ? <Loader2 size={13} className="animate-spin" /> : null}
                {t("join")}
              </button>
            </div>
            <span className="text-[12px] text-tui-ink3">{t("codeHint")}</span>
          </form>

          <form
            className="flex flex-col gap-3 rounded-[10px] border border-tui-ink/16 bg-tui-bg/55 p-[18px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !creating) onCreate(name.trim());
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-tui-accent/45 text-tui-accent">
                <Plus size={14} />
              </span>
              <span className="font-display text-[21px] leading-[1.1]">{t("startOne")}</span>
            </div>
            <p className="m-0 text-[13px] leading-normal text-tui-ink2">{t("startOneBody")}</p>
            <div className="flex gap-2">
              <input
                id="team-empty-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("createPlaceholder")}
                aria-label={t("createTitle")}
                autoComplete="organization"
                maxLength={256}
                className={FIELD}
              />
              <button type="submit" disabled={!name.trim() || creating} className={cn(TEAM_PRIMARY_BUTTON, "h-10")}>
                {creating ? <Loader2 size={13} className="animate-spin" /> : null}
                {t("create")}
              </button>
            </div>
            <span className="text-[12px] text-tui-ink3">{t("startOneHint")}</span>
          </form>
        </div>

        {email ? (
          <span className="mt-[26px] inline-flex max-w-full items-center gap-[9px] rounded-full border border-tui-ink/8 px-3.5 py-2 text-[12.5px] text-tui-ink3">
            <span className="chat-breathe h-[7px] w-[7px] flex-none rounded-full bg-tui-ok" />
            <span className="truncate">{t("watching", { email })}</span>
          </span>
        ) : null}
      </div>
    </main>
  );
}

/**
 * The right pane when there is no one to pick: what joining means, drawn from
 * the real role templates so the meters can't drift from what a role grants.
 */
export function TeamRolesGuide() {
  const t = useTranslations("team");
  const tRoles = useTranslations("settings.workspace.roles");

  return (
    <aside className={cn(TEAM_PANE, "team-slide flex min-h-0 flex-col gap-[18px] px-[22px] py-6")} aria-label={t("guideEyebrow")}>
      <span className={TEAM_EYEBROW}>{t("guideEyebrow")}</span>
      <h3 className="m-0 font-display text-[24px] leading-[1.1] font-normal">{t("guideTitle")}</h3>
      <p className="m-0 text-[13px] text-tui-ink2">{t("guideBody")}</p>
      <div className="flex flex-col">
        {TEMPLATE_ROLE_ORDER.map((r) => {
          const flags = flagsForRole(r);
          const granted = PERMISSION_FLAG_KEYS.filter((k) => flags[k]).length;
          return (
            <div key={r} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-tui-ink/8 py-3">
              <span className="font-display text-[18px]">{tRoles(r)}</span>
              <span className="flex gap-[3px]" role="img" aria-label={`${granted} / 8`}>
                {PERMISSION_FLAG_KEYS.map((k, i) => (
                  <i
                    key={k}
                    className={cn(
                      "h-[9px] w-[9px] rounded-[2px] border",
                      i < granted ? "border-tui-accent bg-tui-accent" : "border-tui-ink/16",
                    )}
                  />
                ))}
              </span>
              <span className="col-span-2 text-[12.5px] leading-[1.45] text-tui-ink3">{t(ROLE_DESC_KEYS[r])}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2.5 rounded-lg border border-tui-ink/8 bg-tui-ink/[0.025] px-3.5 py-3 text-[12.5px] leading-normal text-tui-ink2">
        <Lock size={13} className="mt-0.5 flex-none text-tui-ink3" />
        <span>{t("guidePersonal")}</span>
      </div>
    </aside>
  );
}
