import type { MemberPermissionFlags, OrgRole } from "~/lib/permissions";

/**
 * Shared pieces of the Team page (`/orgs`).
 *
 * It is drawn in the same terminal-edition palette as Progress and Chats:
 * warm `tui-pane` panes on the hatched `tui-screen`, hairlines from `tui-ink`
 * at low opacity, and one lavender accent kept for state.
 */

export const TEAM_PANE =
  "bg-tui-pane border border-tui-ink/10 rounded-lg shadow-[var(--tui-pane-shadow)]";

/** The small spaced caps over a section — "WORKSPACES", "ROLE", "CAN". */
export const TEAM_EYEBROW = "text-[11px] font-medium tracking-[0.18em] uppercase text-tui-ink3";

/** A ghost pill button: Decline, Set active, Join with a code. */
export const TEAM_GHOST_BUTTON =
  "kairos-tap h-9 rounded-full border border-tui-ink/16 bg-transparent px-4 text-[13px] font-medium text-tui-ink transition-colors hover:bg-tui-accent/6 disabled:cursor-not-allowed disabled:opacity-50";

/** The filled accent pill: Invite, Accept, Send invitation. */
export const TEAM_PRIMARY_BUTTON =
  "kairos-tap flex items-center justify-center gap-2 h-9 rounded-full border-0 bg-tui-accent px-4 text-[13px] font-semibold text-tui-on-accent transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45";

/** A round outline control: leave, copy, revoke. */
export const TEAM_ROUND_BUTTON =
  "kairos-tap grid place-items-center flex-none rounded-full border border-tui-ink/16 bg-transparent text-tui-ink2 transition-colors hover:bg-tui-accent/6 disabled:opacity-50";

/** An outline pill that lights up in the accent when `on`. */
export function teamPill(on: boolean): string {
  return on
    ? "border-tui-accent/50 bg-tui-accent/14 text-tui-accent"
    : "border-tui-ink/16 bg-transparent text-tui-ink2 hover:bg-tui-accent/6";
}

/** The staggered rise rows and cards enter with; capped so long lists don't drag. */
export function stagger(index: number): React.CSSProperties {
  return { animationDelay: `${Math.min(index, 12) * 32}ms` };
}

/** `worker` is `member` under its older name; the page only ever shows four. */
export type ShownRole = "admin" | "member" | "mentor" | "guest";

export function shownRole(role: string | null | undefined): ShownRole {
  if (role === "admin" || role === "mentor" || role === "guest") return role;
  return "member";
}

/** i18n keys under `team` for each built-in role's one-line description. */
export const ROLE_DESC_KEYS = {
  admin: "roleDescAdmin",
  member: "roleDescMember",
  mentor: "roleDescMentor",
  guest: "roleDescGuest",
} as const satisfies Record<ShownRole, string>;

/** Role pills are toned: admins in the accent, mentors in the day blue, guests quiet. */
export const ROLE_TONE: Record<ShownRole, { pill: string; on: string }> = {
  admin: {
    pill: "border-tui-accent/45 text-tui-accent",
    on: "border-tui-accent/50 bg-tui-accent/14 text-tui-accent",
  },
  mentor: {
    pill: "border-tui-day/45 text-tui-day",
    on: "border-tui-day/50 bg-tui-day/14 text-tui-day",
  },
  member: {
    pill: "border-tui-ink/16 text-tui-ink2",
    on: "border-tui-ink/40 bg-tui-ink/8 text-tui-ink",
  },
  guest: {
    pill: "border-tui-ink/16 text-tui-ink3",
    on: "border-tui-ink/40 bg-tui-ink/8 text-tui-ink",
  },
};

export interface TeamMember extends MemberPermissionFlags {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: OrgRole;
  displayRole: string | null;
  joinedAt: Date | string | null;
}

export interface CustomRole extends MemberPermissionFlags {
  id: number;
  name: string;
}
