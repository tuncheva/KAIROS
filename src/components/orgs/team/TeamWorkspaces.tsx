"use client";

import { useTranslations } from "next-intl";

import { KeyRound, Plus, User } from "~/components/ui/icons";
import { OrgBadge } from "~/components/orgs/OrgBadge";
import { cn } from "~/lib/utils";
import {
  TEAM_EYEBROW,
  TEAM_GHOST_BUTTON,
  TEAM_PANE,
  TEAM_PRIMARY_BUTTON,
  shownRole,
  stagger,
} from "./teamUi";

export type WorkspaceId = number | "personal";

export interface WorkspaceItem {
  id: number;
  name: string;
  image: string | null;
  role: string;
  memberCount: number;
}

export interface PendingInvite {
  id: number;
  organizationId: number;
  orgName: string;
  role: string;
  displayRole: string | null;
}

/**
 * The left pane: who you are, the invitations waiting on you, and every
 * workspace you can look at — your personal one first, then each organization.
 * Picking a row only *views* it; making it the active workspace is a separate,
 * explicit action in the middle pane.
 */
export function TeamWorkspaces({
  userName,
  orgs,
  pending,
  view,
  activeId,
  onView,
  onAccept,
  onDecline,
  busyInviteId,
  onJoin,
  onCreate,
}: {
  userName: string;
  orgs: readonly WorkspaceItem[];
  pending: readonly PendingInvite[];
  view: WorkspaceId;
  activeId: WorkspaceId | null;
  onView: (id: WorkspaceId) => void;
  onAccept: (invite: PendingInvite) => void;
  onDecline: (invite: PendingInvite) => void;
  busyInviteId: number | null;
  onJoin: () => void;
  onCreate: () => void;
}) {
  const t = useTranslations("team");
  const tRoles = useTranslations("settings.workspace.roles");

  const row = (
    id: WorkspaceId,
    index: number,
    badge: React.ReactNode,
    name: string,
    sub: string,
  ) => {
    const viewing = view === id;
    return (
      <button
        key={String(id)}
        type="button"
        onClick={() => onView(id)}
        aria-current={viewing ? "true" : undefined}
        style={stagger(index)}
        className={cn(
          "team-slide flex w-full items-center gap-3 rounded-lg border-0 p-2.5 text-left text-tui-ink transition-colors",
          viewing ? "bg-tui-accent/15" : "bg-transparent hover:bg-tui-accent/6",
        )}
      >
        {badge}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("truncate text-[14.5px]", viewing ? "font-semibold" : "font-medium")}>
            {name}
          </span>
          <span className="truncate text-[12.5px] text-tui-ink3">{sub}</span>
        </span>
        {activeId === id ? (
          <span className="flex h-[22px] flex-none items-center rounded-full border border-tui-accent/45 px-[9px] text-[11px] font-semibold text-tui-accent">
            {t("active")}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <aside className={cn(TEAM_PANE, "flex min-h-0 flex-col")} aria-label={t("workspaces")}>
      <div className="flex flex-col gap-2.5 px-[22px] pt-[26px] pb-[18px]">
        <span className={cn(TEAM_EYEBROW, "truncate")}>{userName}</span>
        <div className="flex items-baseline gap-2.5">
          <h1 className="m-0 font-display text-[46px] leading-none font-light tracking-[-0.02em]">
            {t("title")}
          </h1>
          <span className="font-display text-[22px] text-tui-ink3 tabular-nums">{orgs.length}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3.5">
        {pending.length > 0 ? (
          <>
            <span className={cn(TEAM_EYEBROW, "px-2.5 pt-1.5 pb-2")}>{t("waitingForYou")}</span>
            {pending.map((invite) => (
              <div
                key={invite.id}
                className="team-glow mb-3 flex flex-col gap-3 rounded-lg border border-tui-accent/45 bg-tui-accent/6 p-3.5"
              >
                <div className="flex items-center gap-3">
                  <OrgBadge id={invite.organizationId} name={invite.orgName} size={36} rounded="rounded-[9px]" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[14.5px] font-semibold">{invite.orgName}</span>
                    <span className="text-[12.5px] text-tui-ink2">
                      {t("invitedAs", { role: invite.displayRole ?? tRoles(shownRole(invite.role)) })}
                    </span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyInviteId === invite.id}
                    onClick={() => onAccept(invite)}
                    className={cn(TEAM_PRIMARY_BUTTON, "h-8 flex-1 text-[12.5px]")}
                  >
                    {t("accept")}
                  </button>
                  <button
                    type="button"
                    disabled={busyInviteId === invite.id}
                    onClick={() => onDecline(invite)}
                    className={cn(TEAM_GHOST_BUTTON, "h-8 flex-1 text-[12.5px]")}
                  >
                    {t("decline")}
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : null}

        <span className={cn(TEAM_EYEBROW, "px-2.5 pt-1.5 pb-2")}>{t("workspaces")}</span>
        {row(
          "personal",
          0,
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[9px] bg-tui-ink/5 text-tui-ink3">
            <User size={15} />
          </span>,
          t("personalWorkspace"),
          t("justYou"),
        )}
        {orgs.length === 0 ? (
          <div
            className="mx-2.5 mt-2.5 flex h-10 items-center gap-2.5 rounded-lg border border-dashed border-tui-ink/16 px-2.5 text-[12.5px] text-tui-ink3"
            aria-hidden="true"
          >
            <i className="h-[22px] w-[22px] flex-none rounded-md border border-dashed border-tui-ink/16" />
            {t("orgsAppearHere")}
          </div>
        ) : null}
        {orgs.map((org, i) =>
          row(
            org.id,
            i + 1,
            <OrgBadge id={org.id} name={org.name} image={org.image} size={36} rounded="rounded-[9px]" />,
            org.name,
            t("wsSub", { role: tRoles(shownRole(org.role)), count: org.memberCount }),
          ),
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-tui-ink/8 px-4 pt-3.5 pb-4">
        <button type="button" onClick={onJoin} className={cn(TEAM_GHOST_BUTTON, "flex items-center justify-center gap-2")}>
          <KeyRound size={14} className="text-tui-ink2" />
          {t("joinWithCode")}
        </button>
        {/* Not in the refined design, which only joins — but the old page could
            start an organization, and losing that would strand new teams. */}
        <button type="button" onClick={onCreate} className={cn(TEAM_GHOST_BUTTON, "flex items-center justify-center gap-2")}>
          <Plus size={14} className="text-tui-ink2" />
          {t("newOrg")}
        </button>
      </div>
    </aside>
  );
}
