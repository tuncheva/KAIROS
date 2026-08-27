"use client";

/**
 * The small pieces the notes panes share.
 *
 * Kept together because they are the vocabulary of the surface — an avatar, a
 * stack of people a note is shared with, a metadata chip — and every pane needs
 * the same ones to look like one design rather than three. The rules about
 * *which* notes are on screen live in `notesData.ts`, away from React.
 */

import Image from "next/image";

import type { NoteUser } from "./notesData";

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
  ringClass = "ring-bg-secondary",
}: {
  user: NoteUser;
  size?: keyof typeof AVATAR_SIZES;
  ringClass?: string;
}) {
  const { px, cls } = AVATAR_SIZES[size];
  const label = user.name ?? user.email ?? "";

  return user.image ? (
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
      className={`${cls} rounded-full grid place-items-center font-bold text-white bg-gradient-to-br from-accent-primary to-accent-secondary ring-2 ${ringClass}`}
    >
      {initialOf(user)}
    </span>
  );
}

/** Overlapping avatars for the people a note is shared with. */
export function SharedAvatars({
  users,
  max = 3,
  ringClass = "ring-bg-secondary",
  label,
}: {
  users: NoteUser[];
  max?: number;
  ringClass?: string;
  label: string;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;

  return (
    <span className="flex items-center" title={label}>
      {shown.map((user, index) => (
        <span key={user.id} className={index === 0 ? "" : "-ml-1.5"}>
          <NoteAvatar user={user} ringClass={ringClass} />
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
 * A metadata chip.
 *
 * `tone` exists because lock and share are orthogonal states that the old card
 * treated as mutually exclusive — a shared note that was also encrypted showed
 * only "Shared", so the lock was invisible exactly where it mattered most.
 */
export function MetaChip({
  tone = "neutral",
  icon,
  children,
  title,
}: {
  tone?: "neutral" | "lock" | "share" | "calendar";
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
}) {
  const tones = {
    neutral: "bg-bg-tertiary text-fg-tertiary",
    lock: "bg-error/12 text-error",
    share: "bg-accent-primary/12 text-accent-primary",
    calendar: "bg-info/12 text-info",
  } as const;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold uppercase tracking-wide whitespace-nowrap ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
