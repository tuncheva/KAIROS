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
   The quiet edition drops the mono-uppercase micro-label of the terminal tier.
   On this surface the chrome speaks in small grey sans; mono is reserved for
   keycaps (⌘K, esc) alone, so a section header, a meta line and a word count
   read as ordinary quiet text rather than as machine labels. */
export const MICRO = "text-[12px] font-medium text-fg-tertiary";
/** A timestamp. Sans and tabular, the same quiet grey as a label. */
export const STAMP = "text-[11.5px] tabular-nums text-fg-tertiary";

/* ── Buttons ──────────────────────────────────────────────────────────────
   The primary action is a neutral high-contrast button — ink on ground — not
   an accent fill. On the quiet surface the violet accent is spent only on the
   things that carry meaning (a pin, a selected row, a link, the caret), so a
   dialog's confirm button is `bg-fg-primary text-bg-primary` and the accent is
   left alone. */
export const BTN_ACCENT =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-fg-primary px-3.5 text-[13px] font-semibold text-bg-primary transition-opacity hover:opacity-90 active:opacity-80 disabled:pointer-events-none disabled:opacity-40";
/** A bare icon-only "new note" control — a pen, not a filled square. */
export const BTN_ACCENT_SQUARE =
  "kairos-tap grid h-[30px] w-[30px] place-items-center rounded-lg text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary active:scale-95";
export const BTN_GHOST =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-medium px-3.5 text-[13px] font-medium text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-40";
export const BTN_DANGER =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-error px-3.5 text-[13px] font-semibold text-bg-primary transition-opacity hover:opacity-90 active:opacity-80 disabled:pointer-events-none disabled:opacity-40";

/** A 30px icon-only control. Bare on the quiet surface — a hover wash, no border. */
export const ICON_BTN =
  "kairos-tap grid h-[30px] w-[30px] flex-none place-items-center rounded-lg text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary active:scale-95";
/** The same shape, quieter ink, for icon buttons packed into a header. */
export const ICON_BTN_BARE =
  "kairos-tap grid h-8 w-8 flex-none place-items-center rounded-lg text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-primary active:scale-95";
/** Bare, but holding the accent "on" state — a note that is pinned or shared. */
export const ICON_BTN_ON =
  "kairos-tap grid h-8 w-8 flex-none place-items-center rounded-lg text-accent-primary transition-colors hover:bg-bg-tertiary active:scale-95";

/* ── Chips ────────────────────────────────────────────────────────────────
   A quiet rounded pill in sans, for the filter and sort controls. (These move
   into the ⌘K command surface in the next pass; until then they stay, dressed
   in the quiet language rather than the terminal one.) */
export const CHIP =
  "inline-flex h-[30px] flex-none items-center gap-1.5 rounded-full border px-3 text-[12.5px] whitespace-nowrap transition-colors";
export const CHIP_IDLE = "border-border-medium text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary";
export const CHIP_ON = "border-accent-primary/40 bg-accent-primary/10 text-accent-primary";

/* ── Fields ───────────────────────────────────────────────────────────────
   A bordered shell with the focus state on the shell rather than the input, so
   a field with a reveal button inside it still reads as one control. Softer and
   rounder than the terminal field, and no ring — the border warming to accent
   is the whole affordance. */
export const FIELD =
  "flex h-[42px] items-center gap-2.5 rounded-lg border border-border-medium bg-bg-surface px-3.5 transition-colors focus-within:border-accent-primary/55";
export const FIELD_TALL =
  "flex items-start gap-2.5 rounded-lg border border-border-medium bg-bg-surface px-3.5 py-2.5 transition-colors focus-within:border-accent-primary/55";
/** The input itself, inside a `FIELD`. */
export const FIELD_INPUT =
  "min-w-0 flex-1 border-0 bg-transparent text-[14px] text-fg-primary caret-accent-primary outline-none placeholder:text-fg-quaternary";
/** Field label. Quiet grey sans, a touch quieter than the value it labels. */
export const FIELD_LABEL =
  "mb-1.5 block text-[12px] font-medium text-fg-secondary";

/* ── Surfaces ─────────────────────────────────────────────────────────────
   One elevation language for every menu, popover and dialog on the surface —
   a raised warm panel with a hairline and a soft lift. */
export const POPOVER_SURFACE =
  "rounded-xl border border-border-medium bg-bg-elevated shadow-xl";
export const DIALOG_SURFACE =
  "overflow-hidden rounded-2xl border border-border-medium bg-bg-elevated shadow-2xl";

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
 * A fact.
 *
 * On the quiet surface a note's state is not a pill — it is a small grey line
 * with a tinted glyph, the way the editor footer names what a note is (pinned,
 * locked, on a date, shared). `tone` carries the colour because lock and share
 * are orthogonal states; the fill and the border are gone entirely, so Locked /
 * Shared / a date / a notebook read as one quiet family rather than four chips.
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
    neutral: "text-fg-tertiary",
    lock: "text-fg-tertiary",
    share: "text-fg-tertiary",
    calendar: "text-info",
    ok: "text-success",
  } as const;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
