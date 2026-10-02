"use client";

/**
 * Small pieces the chat panes share.
 *
 * Kept together because they are the vocabulary of the surface — an avatar with
 * a presence dot, a day separator, a file size — and every pane needs the same
 * ones to look like one design rather than three.
 */

import Image from "next/image";

import { Panel, TitledPanel } from "~/components/ui/Panel";
import { Stamp } from "~/components/ui/Stamp";
import { ProfileLink } from "~/components/profile/ProfileLink";

/* The card shell and the mono stamp live in `components/ui`; re-exported
   here so the chat panes read their whole vocabulary from one file, the same
   way the publish panes read theirs from `publishUi`. */
export { Panel, TitledPanel, Stamp };

export interface ChatUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/** First letter of whatever we can display, for the fallback avatar. */
export function initialOf(user: Pick<ChatUser, "name" | "email"> | null | undefined): string {
  const source = user?.name ?? user?.email ?? "";
  return source.trim().charAt(0).toUpperCase() || "?";
}

export function displayName(user: ChatUser | null | undefined, fallback: string): string {
  return user?.name ?? user?.email ?? fallback;
}

/* The refined chat surface is drawn in the terminal-edition palette the
   dashboard and progress pages use: warm panes on a hatched ground, hairlines
   from `tui-ink`, a single lavender accent. These are the pieces every pane
   repeats, so the three of them read as one design. */

/** A pane on the hatched ground — rail, thread, details. */
export const CHAT_PANE =
  "bg-tui-pane border border-tui-ink/10 rounded-lg shadow-[var(--tui-pane-shadow)]";

/** The small spaced caps over a section — "PINNED", "IN MESSAGES". */
export const CHAT_EYEBROW =
  "text-[11px] font-medium tracking-[0.18em] uppercase text-tui-ink3";

/** A round outline control: header search, details toggle, close. */
export const CHAT_ICON_BUTTON =
  "kairos-tap grid place-items-center flex-none rounded-full border border-tui-ink/16 bg-transparent text-tui-ink2 transition-colors hover:bg-tui-accent/6 disabled:opacity-50";

/** An outline pill — filters, tags, reactions. `on` lights it in the accent. */
export function chatPill(on: boolean): string {
  return on
    ? "border-tui-accent/45 bg-tui-accent/15 text-tui-accent"
    : "border-tui-ink/16 bg-transparent text-tui-ink2 hover:bg-tui-accent/6";
}

const SIZES = {
  sm: { px: 26, cls: "w-[26px] h-[26px] text-[12px]", dot: "w-[8px] h-[8px]" },
  md: { px: 38, cls: "w-[38px] h-[38px] text-[18px]", dot: "w-[9px] h-[9px]" },
  lg: { px: 42, cls: "w-[42px] h-[42px] text-[20px]", dot: "w-[10px] h-[10px]" },
  xl: { px: 72, cls: "w-[72px] h-[72px] text-[32px]", dot: "w-[12px] h-[12px]" },
} as const;

export function Avatar({
  user,
  size = "md",
  online,
  ringClass = "border-tui-pane",
  fallbackLabel = "User",
  peek = false,
}: {
  user: ChatUser | null | undefined;
  size?: keyof typeof SIZES;
  /** Draws the green presence dot when true. Offline people carry no dot. */
  online?: boolean;
  /** The dot's border has to match whatever surface it sits on. */
  ringClass?: string;
  fallbackLabel?: string;
  /**
   * Make the face open the profile drawer.
   *
   * Off by default because half of this component's call sites sit *inside* a
   * button — a conversation row, a person row in the new-chat modal — and
   * `ProfileLink` renders a real button, which cannot legally nest. Those rows
   * also already mean something else when tapped, so the opt-in is the honest
   * default: switch it on where the avatar is the only thing under the finger.
   */
  peek?: boolean;
}) {
  const { px, cls, dot } = SIZES[size];

  const face = (
    <div className={`relative flex-shrink-0 ${cls}`}>
      {user?.image ? (
        <Image
          src={user.image}
          alt={displayName(user, fallbackLabel)}
          width={px}
          height={px}
          className={`${cls} rounded-full border border-tui-ink/16 object-cover`}
        />
      ) : (
        /* A serif initial on a faint wash rather than a coloured gradient —
           the refined surface keeps colour for state. */
        <div
          className={`${cls} grid place-items-center rounded-full border border-tui-ink/16 bg-tui-ink/5 font-display leading-none text-tui-ink`}
          aria-hidden="true"
        >
          {initialOf(user)}
        </div>
      )}
      {online && (
        <span
          className={`absolute ${size === "xl" ? "right-[3px] bottom-[3px]" : "-right-px -bottom-px"} ${dot} rounded-full border-2 ${ringClass} bg-tui-ok`}
        />
      )}
    </div>
  );

  if (!peek) return face;

  return (
    <ProfileLink
      userId={user?.id}
      name={displayName(user, fallbackLabel)}
      className="flex-shrink-0"
    >
      {face}
    </ProfileLink>
  );
}

/** Bytes as something a person reads, e.g. "2.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Same calendar day in the viewer's timezone? Drives the day separators. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * "Today" / "Yesterday" / a date, for the separators between message groups.
 *
 * Compares calendar days rather than elapsed hours — 23:59 and 00:01 are a day
 * apart to a reader even though they are two minutes apart to a clock.
 */
export function formatDayLabel(date: Date, locale: string, labels: { today: string; yesterday: string }): string {
  const now = new Date();
  if (isSameDay(date, now)) return labels.today;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return labels.yesterday;

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatTime(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Rail timestamps: a time today, "Yesterday", a weekday within the week, then a
 * date — the usual shorthand, so the column stays narrow.
 */
export function formatRailTimestamp(
  date: Date,
  locale: string,
  labels: { yesterday: string },
): string {
  const now = new Date();
  if (isSameDay(date, now)) return formatTime(date, locale);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return labels.yesterday;

  const daysAgo = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo < 7) return date.toLocaleDateString(locale, { weekday: "short" });

  return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
}
