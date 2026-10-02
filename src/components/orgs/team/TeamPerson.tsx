"use client";

import { useLocale, useTranslations } from "next-intl";

import { Avatar } from "~/components/chat/chatUi";
import { Check, Lock, MessageCircle, UserMinus } from "~/components/ui/icons";
import { PERMISSION_DISPLAY_ORDER, usePermissionLabel } from "~/components/orgs/PermissionGrid";
import {
  TEMPLATE_ROLE_ORDER,
  flagsForRole,
  pickPermissionFlags,
  sameFlags,
  type MemberPermissionFlags,
} from "~/lib/permissions";
import { cn } from "~/lib/utils";
import {
  ROLE_TONE,
  TEAM_EYEBROW,
  TEAM_PANE,
  shownRole,
  type CustomRole,
  type TeamMember,
} from "./teamUi";

/** One tick: the box, its label, and a lock when it can't be changed here. */
export function Tick({
  label,
  on,
  locked,
  title,
  onToggle,
  dimWhenLocked = false,
}: {
  label: string;
  on: boolean;
  locked: boolean;
  title?: string;
  onToggle?: () => void;
  /** The invite builder greys out flags the inviter can't hand out. */
  dimWhenLocked?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={locked}
      title={title}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-3 rounded-md border-0 bg-transparent px-2 py-[7px] text-left text-[13.5px] transition-colors",
        locked ? "cursor-default" : "cursor-pointer hover:bg-tui-accent/6",
        dimWhenLocked && locked ? "text-tui-ink3" : on ? "text-tui-ink" : locked ? "text-tui-ink3" : "text-tui-ink2",
      )}
    >
      <span
        className={cn(
          "grid h-4 w-4 flex-none place-items-center rounded-[4px] border",
          on ? "border-tui-accent/45 bg-tui-accent/15" : "border-tui-ink/16 bg-transparent",
        )}
      >
        {on ? <Check size={10} className="team-pop text-tui-accent" /> : null}
      </span>
      <span className="flex-1">{label}</span>
      {locked ? <Lock size={11} className="text-tui-ink3 opacity-60" /> : null}
    </button>
  );
}

/**
 * The right pane: one person — who they are, their role, the eight ticks, and
 * when they joined. What can be changed follows the viewer's own flags; the
 * server checks the same rules again on every mutation.
 */
export function TeamPerson({
  member,
  isMe,
  online,
  customRoles,
  canManage,
  canRemove,
  onMessage,
  messaging,
  onRemove,
  onPickRole,
  onPickCustomRole,
  onToggleFlags,
}: {
  member: TeamMember | null;
  isMe: boolean;
  online: boolean;
  customRoles: readonly CustomRole[];
  canManage: boolean;
  canRemove: boolean;
  onMessage: () => void;
  messaging: boolean;
  onRemove: () => void;
  onPickRole: (role: (typeof TEMPLATE_ROLE_ORDER)[number]) => void;
  onPickCustomRole: (role: CustomRole) => void;
  onToggleFlags: (next: MemberPermissionFlags) => void;
}) {
  const t = useTranslations("team");
  const tRoles = useTranslations("settings.workspace.roles");
  const locale = useLocale();
  const label = usePermissionLabel();

  if (!member) {
    return (
      <aside className={cn(TEAM_PANE, "flex min-h-0 flex-col overflow-hidden")}>
        <div className="flex flex-1 items-center justify-center p-8 text-center text-[13.5px] leading-[1.55] text-tui-ink3">
          {t("pickSomeone")}
        </div>
      </aside>
    );
  }

  const editable = canManage && !isMe;
  const role = shownRole(member.role);
  const flags = pickPermissionFlags(member);
  const edited = !member.displayRole && !sameFlags(flags, flagsForRole(role));
  const note = member.displayRole
    ? t("customRoleNote", { name: member.displayRole })
    : edited
      ? t("editedFrom", { role: tRoles(role) })
      : t("matches", { role: tRoles(role) });
  const joined = member.joinedAt
    ? new Date(member.joinedAt).toLocaleDateString(locale, { month: "short", year: "numeric" })
    : null;
  const name = member.name ?? member.email ?? "—";

  const rolePill = (key: string, text: string, on: boolean, toneOn: string, onPick: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      disabled={!editable}
      onClick={onPick}
      className={cn(
        "h-[30px] rounded-full border px-3 text-[12.5px] font-medium transition-colors",
        on ? toneOn : "border-tui-ink/16 bg-transparent text-tui-ink2",
        editable ? (on ? "" : "hover:bg-tui-accent/6") : "cursor-default",
        !editable && !on && "opacity-50",
      )}
    >
      {text}
    </button>
  );

  return (
    <aside className={cn(TEAM_PANE, "flex min-h-0 flex-col overflow-hidden")} aria-label={name}>
      {/* Keyed by person so switching re-runs the slide. */}
      <div key={member.id} className="team-slide flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col items-center gap-2.5 border-b border-tui-ink/8 px-6 pt-7 pb-[22px] text-center">
          <Avatar user={member} size="xl" online={online} />
          <span className="font-display text-[27px] leading-[1.1] tracking-[-0.01em]">{name}</span>
          {member.email ? <span className="text-[13px] text-tui-ink3">{member.email}</span> : null}
          <span className="text-[12.5px] text-tui-ink2">
            {online ? t("onlineNow") : joined ? t("joinedOn", { date: joined }) : null}
          </span>
          <div className="mt-1.5 flex gap-2">
            {!isMe ? (
              <button
                type="button"
                onClick={onMessage}
                disabled={messaging}
                className="kairos-tap flex h-8 items-center gap-[7px] rounded-full border border-tui-ink/16 bg-transparent px-3.5 text-[12.5px] font-medium text-tui-ink transition-colors hover:bg-tui-accent/6 disabled:opacity-50"
              >
                <MessageCircle size={13} className="text-tui-ink2" />
                {t("message")}
              </button>
            ) : null}
            {canRemove ? (
              <button
                type="button"
                onClick={onRemove}
                className="kairos-tap flex h-8 items-center gap-[7px] rounded-full border border-tui-danger/40 bg-transparent px-3.5 text-[12.5px] font-medium text-tui-danger transition-colors hover:bg-tui-danger/8"
              >
                <UserMinus size={13} />
                {t("remove")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-tui-ink/8 px-6 py-5">
          <span className={TEAM_EYEBROW}>{t("role")}</span>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_ROLE_ORDER.map((r) =>
              rolePill(r, tRoles(r), role === r && !member.displayRole, ROLE_TONE[r].on, () => onPickRole(r)),
            )}
            {customRoles.map((r) =>
              rolePill(
                `custom-${r.id}`,
                r.name,
                member.displayRole === r.name,
                ROLE_TONE.member.on,
                () => onPickCustomRole(r),
              ),
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3.5 border-b border-tui-ink/8 px-6 py-5">
          <div className="flex items-baseline gap-2">
            <span className={cn(TEAM_EYEBROW, "flex-1")}>{t("can")}</span>
            <span className={cn("text-[12px]", edited ? "text-tui-warn" : "text-tui-ink3")}>{note}</span>
          </div>
          <div className="-mx-2 flex flex-col gap-0.5">
            {PERMISSION_DISPLAY_ORDER.map((key) => (
              <Tick
                key={key}
                label={label(key)}
                on={flags[key]}
                locked={!editable}
                onToggle={() => onToggleFlags({ ...flags, [key]: !flags[key] })}
              />
            ))}
          </div>
          {!editable ? (
            <span className="text-[12.5px] leading-normal text-tui-ink3">
              {isMe ? t("lockedSelf") : t("lockedOther")}
            </span>
          ) : null}
        </div>

        {joined ? (
          <div className="px-6 pt-5 pb-6">
            <span className="text-[12.5px] text-tui-ink3">{t("joinedOn", { date: joined })}</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
