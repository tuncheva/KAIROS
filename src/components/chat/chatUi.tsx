"use client";

/**
 * Small pieces the chat panes share.
 *
 * Kept together because they are the vocabulary of the surface — an avatar with
 * a presence dot, a day separator, a file size — and every pane needs the same
 * ones to look like one design rather than three.
 */

import Image from "next/image";

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

const SIZES = {
  sm: { px: 26, cls: "w-[26px] h-[26px] text-[10px]" },
  md: { px: 38, cls: "w-[38px] h-[38px] text-[13px]" },
  lg: { px: 44, cls: "w-11 h-11 text-sm" },
  xl: { px: 56, cls: "w-14 h-14 text-lg" },
} as const;

export function Avatar({
  user,
  size = "md",
  online,
  ringClass = "ring-bg-surface",
  fallbackLabel = "User",
}: {
  user: ChatUser | null | undefined;
  size?: keyof typeof SIZES;
  /** `undefined` renders no dot at all — distinct from a grey "offline" dot. */
  online?: boolean;
  /** The dot's border has to match whatever surface it sits on. */
  ringClass?: string;
  fallbackLabel?: string;
}) {
  const { px, cls } = SIZES[size];

  return (
    <div className={`relative flex-shrink-0 ${cls}`}>
      {user?.image ? (
        <Image
          src={user.image}
          alt={displayName(user, fallbackLabel)}
          width={px}
          height={px}
          className={`${cls} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${cls} rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white font-bold`}
          aria-hidden="true"
        >
          {initialOf(user)}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 w-[11px] h-[11px] rounded-full ring-2 ${ringClass} ${
            online ? "bg-success" : "bg-fg-quaternary"
          }`}
        />
      )}
    </div>
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
