"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Avatar } from "~/components/chat/chatUi";
import { Check, Copy, Eye, LogOut, Mail, Search, Trash2, User, UserPlus } from "~/components/ui/icons";
import { OrgBadge } from "~/components/orgs/OrgBadge";
import {
  PERMISSION_DISPLAY_ORDER,
  usePermissionLabel,
  usePermissionSummary,
} from "~/components/orgs/PermissionGrid";
import {
  TEMPLATE_ROLE_ORDER,
  flagsForRole,
  pickPermissionFlags,
  type MemberPermissionFlags,
} from "~/lib/permissions";
import { cn } from "~/lib/utils";
import {
  ROLE_DESC_KEYS,
  ROLE_TONE,
  TEAM_GHOST_BUTTON,
  TEAM_PANE,
  TEAM_PRIMARY_BUTTON,
  TEAM_ROUND_BUTTON,
  shownRole,
  stagger,
  teamPill,
  type CustomRole,
  type ShownRole,
  type TeamMember,
} from "./teamUi";

export type TeamTab = "people" | "invites" | "roles";

export interface InviteLinkRow {
  id: number;
  code: string;
  url: string;
  role: string;
  displayRole: string | null;
  permissions: MemberPermissionFlags;
  usedCount: number;
  maxUses: number;
  expiresAt: Date | string;
}

export interface EmailInviteRow {
  id: number;
  email: string;
  role: string;
  displayRole: string | null;
  createdAt: Date | string;
}

type RoleFilter = "all" | ShownRole;

/** The personal workspace has no people, invites or roles — just a word on what it is. */
export function TeamPersonal({ isActive, onSetActive, busy }: { isActive: boolean; onSetActive: () => void; busy: boolean }) {
  const t = useTranslations("team");
  return (
    <main className={cn(TEAM_PANE, "flex min-h-[420px] min-w-0 flex-col")}>
      <div className="team-rise flex flex-1 flex-col items-center justify-center gap-3.5 p-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full border border-tui-ink/16 text-tui-ink3">
          <User size={22} />
        </span>
        <h2 className="m-0 font-display text-[34px] font-light tracking-[-0.01em]">{t("personalWorkspace")}</h2>
        <p className="m-0 max-w-[420px] text-[14.5px] leading-[1.55] text-pretty text-tui-ink2">{t("personalBody")}</p>
        {!isActive ? (
          <button type="button" disabled={busy} onClick={onSetActive} className={cn(TEAM_GHOST_BUTTON, "mt-1.5 px-[18px]")}>
            {t("switchToPersonal")}
          </button>
        ) : null}
      </div>
    </main>
  );
}

/**
 * The middle pane: the organization being viewed, and its people, live
 * invites and roles in three tabs.
 */
export function TeamOrg({
  org,
  members,
  meId,
  isOnline,
  customRoles,
  links,
  emailInvites,
  canInvite,
  canManage,
  canSeeEmails,
  isActive,
  switching,
  tab,
  onTab,
  selectedId,
  onSelect,
  onSetActive,
  onInvite,
  onLeave,
  onRevokeLink,
  onRevokeEmail,
  onCopy,
  copiedId,
}: {
  org: { id: number; name: string; image: string | null; role: string };
  members: readonly TeamMember[];
  meId: string | null;
  isOnline: (id: string) => boolean;
  customRoles: readonly CustomRole[];
  links: readonly InviteLinkRow[];
  emailInvites: readonly EmailInviteRow[];
  canInvite: boolean;
  canManage: boolean;
  canSeeEmails: boolean;
  isActive: boolean;
  switching: boolean;
  tab: TeamTab;
  onTab: (tab: TeamTab) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSetActive: () => void;
  onInvite: () => void;
  onLeave: () => void;
  onRevokeLink: (id: number) => void;
  onRevokeEmail: (id: number) => void;
  onCopy: (value: string, id: string, message: string) => void;
  copiedId: string | null;
}) {
  const t = useTranslations("team");
  const tRoles = useTranslations("settings.workspace.roles");
  const locale = useLocale();
  const summarize = usePermissionSummary();
  const label = usePermissionLabel();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<RoleFilter>("all");

  const myRole = shownRole(org.role);
  const onlineCount = members.filter((m) => isOnline(m.id)).length;
  const roleName = (m: { role: string; displayRole: string | null }) => m.displayRole ?? tRoles(shownRole(m.role));
  const date = (d: Date | string) => new Date(d).toLocaleDateString(locale, { month: "short", day: "numeric" });

  // ── People ──
  const counts: Record<RoleFilter, number> = { all: members.length, admin: 0, member: 0, mentor: 0, guest: 0 };
  for (const m of members) counts[shownRole(m.role)] += 1;
  const filters: [RoleFilter, string][] = (
    [
      ["all", t("filterAll")],
      ["admin", t("filterAdmins")],
      ["member", t("filterMembers")],
      ["mentor", t("filterMentors")],
      ["guest", t("filterGuests")],
    ] as [RoleFilter, string][]
  ).filter(([k]) => counts[k] > 0);
  const ql = q.trim().toLowerCase();
  const rows = members
    .filter((m) => filter === "all" || shownRole(m.role) === filter)
    .filter((m) => !ql || `${m.name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(ql))
    .slice()
    .sort((a, b) => Number(b.id === meId) - Number(a.id === meId));

  // ── Roles ──
  const roleList = [
    ...TEMPLATE_ROLE_ORDER.map((r) => ({
      key: r,
      name: tRoles(r),
      custom: false,
      desc: t(ROLE_DESC_KEYS[r]),
      flags: flagsForRole(r),
      count: members.filter((m) => shownRole(m.role) === r && !m.displayRole).length,
    })),
    ...customRoles.map((r) => ({
      key: `custom-${r.id}`,
      name: r.name,
      custom: true,
      desc: t("roleDescCustom"),
      flags: pickPermissionFlags(r),
      count: members.filter((m) => m.displayRole === r.name).length,
    })),
  ];

  const tabs: [TeamTab, string, number][] = [
    ["people", t("tabPeople"), members.length],
    ["invites", t("tabInvites"), links.length + emailInvites.length],
    ["roles", t("tabRoles"), roleList.length],
  ];

  const sectionHead = (title: string, hint: string) => (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-tui-ink/8 pb-2.5">
      <span className="font-display text-[22px]">{title}</span>
      <span className="text-[12.5px] text-tui-ink3">{hint}</span>
    </div>
  );

  const emptyLine = (text: string) => <span className="py-[18px] text-[13.5px] text-tui-ink3">{text}</span>;

  return (
    <main className={cn(TEAM_PANE, "flex min-h-[520px] min-w-0 flex-col")}>
      {/* Keyed by org so moving between workspaces replays the entrance. */}
      <div key={org.id} className="team-rise flex flex-wrap items-start gap-[18px] px-5 pt-[26px] sm:px-7">
        <OrgBadge id={org.id} name={org.name} image={org.image} size={56} rounded="rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-[11px] font-medium tracking-[0.18em] text-tui-ink3 uppercase">
            {t("orgEyebrow", {
              role: myRole === "admin" ? t("youAreAdmin") : t("youAreRole", { role: tRoles(myRole).toLowerCase() }),
            })}
          </span>
          <h2 className="m-0 truncate font-display text-[40px] leading-none font-light tracking-[-0.02em]">{org.name}</h2>
          <span className="text-[13px] text-tui-ink3">{t("orgMeta", { count: members.length, online: onlineCount })}</span>
        </div>
        <div className="flex flex-none items-center gap-2">
          {!isActive ? (
            <button type="button" disabled={switching} onClick={onSetActive} className={TEAM_GHOST_BUTTON}>
              {t("setActive")}
            </button>
          ) : null}
          {canInvite ? (
            <button type="button" onClick={onInvite} className={TEAM_PRIMARY_BUTTON}>
              <UserPlus size={14} />
              {t("invite")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLeave}
            title={t("leaveOrg")}
            aria-label={t("leaveOrg")}
            className={cn(TEAM_ROUND_BUTTON, "h-9 w-9")}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {!canInvite && !canManage ? (
        <div className="mx-5 mt-[18px] flex items-center gap-2.5 rounded-lg border border-tui-ink/16 bg-tui-ink/[0.025] px-3.5 py-[11px] text-[13px] text-tui-ink2 sm:mx-7">
          <Eye size={14} className="flex-none text-tui-ink3" />
          {t("viewOnly")}
        </div>
      ) : null}

      <div role="tablist" className="flex gap-1.5 overflow-x-auto border-b border-tui-ink/8 px-5 pt-5 sm:px-7">
        {tabs.map(([id, text, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={cn(
              "-mb-px mr-[18px] flex h-10 items-center gap-[7px] border-0 border-b-[1.5px] bg-transparent px-1 text-[14px] font-medium transition-[color,border-color] duration-200",
              tab === id ? "border-tui-ink text-tui-ink" : "border-transparent text-tui-ink3 hover:text-tui-ink2",
            )}
          >
            {text}
            <span className="text-[12px] text-tui-ink3 tabular-nums">{count}</span>
          </button>
        ))}
      </div>

      {tab === "people" ? (
        <>
          <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4 pb-3 sm:px-7">
            <label className="flex h-9 w-full items-center gap-2.5 rounded-full border border-tui-ink/16 bg-tui-bg pr-2 pl-3.5 sm:w-[280px]">
              <Search size={14} className="flex-none text-tui-ink3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("searchPeople")}
                aria-label={t("searchPeople")}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-tui-ink outline-none placeholder:text-tui-ink3"
              />
            </label>
            <span className="hidden flex-1 sm:block" />
            <div className="flex flex-wrap gap-1.5">
              {filters.map(([k, text]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] font-medium transition-colors",
                    teamPill(filter === k),
                  )}
                >
                  {text}
                  <span className="text-[11.5px] tabular-nums opacity-80">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="hidden h-[30px] grid-cols-[minmax(0,1.5fr)_120px_minmax(0,1.3fr)_96px] items-center gap-4 border-b border-tui-ink/8 px-7 text-[11px] font-medium tracking-[0.14em] text-tui-ink3 uppercase md:grid">
            <span>{t("colPerson")}</span>
            <span>{t("colRole")}</span>
            <span>{t("colCan")}</span>
            <span className="text-right">{t("colJoined")}</span>
          </div>

          <div key={`${filter}-${org.id}`} className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-4 sm:px-4">
            {rows.map((m, i) => {
              const selected = selectedId === m.id;
              const role = shownRole(m.role);
              const online = isOnline(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelect(m.id)}
                  aria-pressed={selected}
                  style={stagger(i)}
                  className={cn(
                    "team-rise grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border-0 px-3 py-2.5 text-left text-tui-ink transition-colors md:grid-cols-[minmax(0,1.5fr)_120px_minmax(0,1.3fr)_96px]",
                    selected ? "bg-tui-accent/15" : "bg-transparent hover:bg-tui-accent/6",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar user={m} size="md" online={online} />
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="truncate text-[14.5px] font-medium">
                        {m.name ?? m.email}
                        {m.id === meId ? <span className="font-normal text-tui-ink3"> · {t("you")}</span> : null}
                      </span>
                      <span className="truncate text-[12.5px] text-tui-ink3">{m.email}</span>
                    </span>
                  </span>
                  <span className="flex">
                    <span
                      className={cn(
                        "flex h-6 items-center rounded-full border px-2.5 text-[12px] font-medium whitespace-nowrap",
                        ROLE_TONE[role].pill,
                      )}
                    >
                      {roleName(m)}
                    </span>
                  </span>
                  <span className="hidden truncate text-[13px] text-tui-ink2 md:block">
                    {summarize(pickPermissionFlags(m), t("viewOnlyShort"))}
                  </span>
                  <span
                    className={cn(
                      "hidden text-right text-[12.5px] tabular-nums md:block",
                      online ? "text-tui-ok" : "text-tui-ink3",
                    )}
                  >
                    {online ? t("online") : m.joinedAt ? date(m.joinedAt) : ""}
                  </span>
                </button>
              );
            })}
            {rows.length === 0 ? (
              <span className="block px-3 py-7 text-[13.5px] text-tui-ink3">{t("noMatch", { q })}</span>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === "invites" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto px-5 pt-[22px] pb-6 sm:px-7">
          {!canInvite ? (
            emptyLine(t("invitesHidden"))
          ) : (
            <>
              <div className="flex flex-col">
                {sectionHead(t("inviteLinks"), t("inviteLinksHint"))}
                {links.map((l, i) => {
                  const copied = copiedId === `link-${l.id}`;
                  return (
                    <div
                      key={l.id}
                      style={stagger(i)}
                      className="team-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-tui-ink/8 py-3.5 md:grid-cols-[150px_minmax(0,1fr)_190px_72px]"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[14.5px] font-medium">{roleName(l)}</span>
                        <span className="font-mono text-[12px] text-tui-ink3">{l.code}</span>
                      </span>
                      <span className="hidden truncate text-[13px] text-tui-ink2 md:block">
                        {summarize(l.permissions, t("viewOnlyShort"))}
                      </span>
                      <span className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
                        <span className="text-[12.5px] text-tui-ink2 tabular-nums">
                          {t("usedOf", { used: l.usedCount, max: l.maxUses })} · {t("expires", { date: date(l.expiresAt) })}
                        </span>
                        <span className="h-[3px] overflow-hidden rounded-sm bg-tui-ink/8">
                          <span
                            className="team-bar block h-[3px] bg-tui-accent"
                            style={{ width: `${Math.round((l.usedCount / Math.max(l.maxUses, 1)) * 100)}%` }}
                          />
                        </span>
                      </span>
                      <span className="col-start-2 row-start-1 flex justify-end gap-1.5 md:col-start-auto md:row-start-auto">
                        <button
                          type="button"
                          title={t("copyLink")}
                          aria-label={t("copyLink")}
                          onClick={() => onCopy(l.url, `link-${l.id}`, t("linkCopied"))}
                          className={cn(TEAM_ROUND_BUTTON, "h-[30px] w-[30px]", copied && "text-tui-ok")}
                        >
                          {copied ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                        <button
                          type="button"
                          title={t("revoke")}
                          aria-label={t("revoke")}
                          onClick={() => onRevokeLink(l.id)}
                          className={cn(TEAM_ROUND_BUTTON, "h-[30px] w-[30px] text-tui-danger hover:bg-tui-danger/8")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {links.length === 0 ? emptyLine(t("noLinks")) : null}
              </div>

              <div className="flex flex-col">
                {sectionHead(t("sentByEmail"), t("sentByEmailHint"))}
                {!canSeeEmails ? emptyLine(t("emailsAdminOnly")) : null}
                {emailInvites.map((e, i) => (
                  <div
                    key={e.id}
                    style={stagger(i + links.length + 1)}
                    className="team-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-tui-ink/8 py-3.5 md:grid-cols-[minmax(0,1fr)_150px_130px_72px]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-dashed border-tui-ink/16 text-tui-ink3">
                        <Mail size={13} />
                      </span>
                      <span className="truncate text-[14px]">{e.email}</span>
                    </span>
                    <span className="hidden text-[13px] text-tui-ink2 md:block">{roleName(e)}</span>
                    <span className="hidden text-[12.5px] text-tui-ink3 md:block">{t("sentOn", { date: date(e.createdAt) })}</span>
                    <span className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onRevokeEmail(e.id)}
                        className="kairos-tap h-7 rounded-full border border-tui-ink/16 bg-transparent px-[11px] text-[12px] text-tui-ink2 transition-colors hover:bg-tui-danger/8"
                      >
                        {t("revoke")}
                      </button>
                    </span>
                  </div>
                ))}
                {canSeeEmails && emailInvites.length === 0 ? emptyLine(t("noEmails")) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === "roles" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2.5 pb-6 sm:px-7">
          {roleList.map((r, ri) => (
            <div
              key={r.key}
              style={stagger(ri)}
              className="team-rise grid grid-cols-1 gap-4 border-b border-tui-ink/8 py-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6"
            >
              <div className="flex flex-col gap-1.5">
                <span className="flex items-baseline gap-2">
                  <span className="font-display text-[22px]">{r.name}</span>
                  {r.custom ? (
                    <span className="text-[11px] tracking-[0.14em] text-tui-ink3 uppercase">{t("custom")}</span>
                  ) : null}
                </span>
                <span className="text-[12.5px] text-tui-ink3">{t("peopleCount", { count: r.count })}</span>
                <span className="text-[13px] leading-normal text-pretty text-tui-ink2">{r.desc}</span>
              </div>
              <div className="grid grid-cols-1 content-start gap-x-5 gap-y-2.5 sm:grid-cols-2">
                {PERMISSION_DISPLAY_ORDER.map((key) => {
                  const on = r.flags[key];
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
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
