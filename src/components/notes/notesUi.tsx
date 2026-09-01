"use client";

/**
 * The small pieces the notes panes share.
 *
 * Kept together because they are the vocabulary of the surface — an avatar, a
 * stack of people a note is shared with, a status badge — and every pane needs
 * the same ones to look like one design rather than three. The rules about
 * *which* notes are on screen live in `notesData.ts`, away from React.
 *
 * The class constants below are the other half of that vocabulary. Notes had
 * grown a parallel dialect: `rounded-2xl` cards, a gradient pill button, three
 * stacked background tints and five different micro-type sizes between 9.5px
 * and 11px — while `DashboardClient` and `CalendarClient` had moved to hairline
 * rules, mono micro-labels and outline-only badges. These strings are that
 * newer language, named once so a row, a menu item and a dialog field cannot
 * drift apart again. Same pattern as `CalendarClient`'s `CHIP_BASE` /
 * `SMALL_CHIP` / `MICRO_LABEL`; deliberately not a component library, because
 * `components/ui/` does not have one and this is not the change that should
 * introduce it.
 */

import Image from "next/image";

import { avatarGradientStyle } from "~/lib/avatarGradient";
import { ProfileLink } from "~/components/profile/ProfileLink";

import type { NoteUser } from "./notesData";

/* ── Type ─────────────────────────────────────────────────────────────────
   One micro-label, replacing `text-[9.5px] tracking-widest`,
   `text-[10px] font-semibold uppercase tracking-wide`, `text-[11px]` and two
   more. Group headers, the sort pill, the word count and menu section labels
   are all the same kind of thing and now look like it. */
export const MICRO = "font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-fg-quaternary";
/** A timestamp. Tighter tracking than a label, because digits are wide. */
export const STAMP = "font-mono text-[9.5px] uppercase tracking-[0.1em] tabular-nums text-fg-quaternary";

/* ── Buttons ──────────────────────────────────────────────────────────────
   The rail's `bg-gradient-to-br from-accent-primary to-accent-secondary` pill
   is gone: gradients appear nowhere else in the recent tier. This is the CTA
   `DashboardClient` uses for its first-run action, which is the one primary
   button shape in the app that is not legacy. */
export const BTN_ACCENT =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[10px] bg-accent-primary px-3.5 text-[13px] font-bold tracking-[-0.005em] text-white transition-all duration-[350ms] hover:-translate-y-[1.5px] hover:bg-accent-hover active:translate-y-0 disabled:pointer-events-none disabled:opacity-50";
export const BTN_ACCENT_SQUARE =
  "inline-grid h-8 w-8 place-items-center rounded-[10px] bg-accent-primary text-white transition-all duration-[350ms] hover:-translate-y-[1.5px] hover:bg-accent-hover active:translate-y-0";
export const BTN_GHOST =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[10px] border border-border-medium px-3.5 text-[13px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-50";
export const BTN_DANGER =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[10px] bg-error px-3.5 text-[13px] font-bold text-white transition-all duration-[350ms] hover:-translate-y-[1.5px] hover:brightness-110 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50";

/** `CalendarClient`'s 30px bordered square, for every icon-only control. */
export const ICON_BTN =
  "kairos-tap grid h-[30px] w-[30px] flex-none place-items-center rounded-[10px] border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary active:scale-95";
/** The same shape without the border, for icon buttons packed into a header. */
export const ICON_BTN_BARE =
  "kairos-tap grid h-7 w-7 flex-none place-items-center rounded-lg text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-primary active:scale-95";
/** Bare, but holding an accent-tinted "on" state — a note that is shared. */
export const ICON_BTN_ON =
  "kairos-tap grid h-7 w-7 flex-none place-items-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-accent-primary transition-colors hover:bg-accent-primary/20 active:scale-95";

/* ── Chips ────────────────────────────────────────────────────────────────
   `CalendarClient`'s `SMALL_CHIP`, in mono. Used by the filter tabs and the
   sort pill, which were two different shapes doing one job. */
export const CHIP =
  "inline-flex h-[26px] flex-none items-center gap-1.5 rounded-md border px-2.5 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap uppercase transition-colors";
export const CHIP_IDLE = "border-border-medium text-fg-tertiary hover:bg-bg-secondary hover:text-fg-primary";
export const CHIP_ON = "border-accent-primary/45 bg-accent-primary/10 text-accent-primary";

/* ── Fields ───────────────────────────────────────────────────────────────
   A bordered shell with the focus ring on the shell rather than the input, so
   a field with a reveal button inside it still reads as one control.
   Replaces `bg-bg-secondary rounded-lg focus:ring-2 focus:ring-accent-primary/35`,
   which had no border and therefore no shape when empty. */
export const FIELD =
  "flex h-[38px] items-center gap-2 rounded-[10px] border border-border-medium bg-bg-surface px-3 transition-colors focus-within:border-accent-primary/60 focus-within:bg-bg-elevated focus-within:ring-[3px] focus-within:ring-accent-primary/10";
export const FIELD_TALL =
  "flex items-start gap-2 rounded-[10px] border border-border-medium bg-bg-surface px-3 py-2.5 transition-colors focus-within:border-accent-primary/60 focus-within:bg-bg-elevated focus-within:ring-[3px] focus-within:ring-accent-primary/10";
/** The input itself, inside a `FIELD`. */
export const FIELD_INPUT =
  "min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-fg-primary outline-none placeholder:text-fg-quaternary";
/** Field label. Quieter than the value it labels, which is the point. */
export const FIELD_LABEL =
  "mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.13em] text-fg-quaternary";

/* ── Surfaces ─────────────────────────────────────────────────────────────
   One elevation language. `kairos-menu-surface` and
   `kairos-system-card-elevated` were split arbitrarily across the six dialogs
   and two menus of this surface; both are replaced by the CalendarClient
   popover surface, which is also what `CommandPalette` uses. */
export const POPOVER_SURFACE =
  "rounded-xl border border-border-medium bg-bg-elevated shadow-xl";
export const DIALOG_SURFACE =
  "overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl";

export function initialOf(user: Pick<NoteUser, "name" | "email"> | null | undefined): string {
  const source = user?.name ?? user?.email ?? "";
  return source.trim().charAt(0).toUpperCase() || "?";
}

const AVATAR_SIZES = {
  sm: { px: 18, cls: "w-[18px] h-[18px] text-[8.5px]" },
  md: { px: 26, cls: "w-[26px] h-[26px] text-[10px]" },
} as const;

export function NoteAvatar({
  user,
  size = "sm",
  ringClass = "ring-bg-primary",
  peek = false,
}: {
  user: NoteUser;
  size?: keyof typeof AVATAR_SIZES;
  ringClass?: string;
  /**
   * Make the face open the profile drawer. Off by default for the same reason
   * as the chat avatar: the note list draws these inside the row button, and
   * `ProfileLink` is itself a button. See `~/components/chat/chatUi`.
   */
  peek?: boolean;
}) {
  const { px, cls } = AVATAR_SIZES[size];
  const label = user.name ?? user.email ?? "";

  const face = user.image ? (
    <Image
      src={user.image}
      alt={label}
      width={px}
      height={px}
      unoptimized
      className={`${cls} rounded-full object-cover ring-2 ${ringClass}`}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`${cls} rounded-full grid place-items-center font-bold text-white ring-2 ${ringClass}`}
      style={avatarGradientStyle(user.id)}
    >
      {initialOf(user)}
    </span>
  );

  if (!peek) return face;

  return (
    <ProfileLink userId={user.id} name={label}>
      {face}
    </ProfileLink>
  );
}

/** Overlapping avatars for the people a note is shared with. */
export function SharedAvatars({
  users,
  max = 3,
  ringClass = "ring-bg-primary",
  label,
  peek = false,
}: {
  users: NoteUser[];
  max?: number;
  ringClass?: string;
  label: string;
  /** Passed straight through to each face. See `NoteAvatar`. */
  peek?: boolean;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;

  return (
    <span className="flex items-center" title={label}>
      {shown.map((user, index) => (
        <span key={user.id} className={index === 0 ? "" : "-ml-1.5"}>
          <NoteAvatar user={user} ringClass={ringClass} peek={peek} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={`-ml-1.5 w-[18px] h-[18px] rounded-full grid place-items-center text-[8.5px] font-bold bg-bg-tertiary text-fg-tertiary ring-2 ${ringClass}`}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

/**
 * A status badge.
 *
 * `tone` exists because lock and share are orthogonal states that the old card
 * treated as mutually exclusive — a shared note that was also encrypted showed
 * only "Shared", so the lock was invisible exactly where it mattered most.
 *
 * The fill is gone. Four filled tints (`bg-error/12`, `bg-accent-primary/12`,
 * `bg-info/12`, `bg-bg-tertiary`) read as four unrelated things and competed
 * with the accent wash on a selected row behind them. This is the dashboard's
 * `STATE_BADGE` pattern instead: one shape, one weight, colour carried by a
 * 40%-alpha border and the label — so Locked / Shared / a date / a notebook
 * read as one family.
 */
export function Badge({
  tone = "neutral",
  icon,
  children,
  title,
}: {
  tone?: "neutral" | "lock" | "share" | "calendar" | "ok";
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
}) {
  const tones = {
    neutral: "border-border-medium/90 text-fg-tertiary",
    lock: "border-error/40 text-error",
    share: "border-accent-primary/40 text-accent-primary",
    calendar: "border-info/40 text-info",
    ok: "border-success/45 text-success",
  } as const;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1.5px] font-mono text-[9.5px] tracking-[0.12em] whitespace-nowrap uppercase ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
