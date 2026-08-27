"use client";

/**
 * The small pieces the publish panes share.
 *
 * Kept together because they are the vocabulary of the surface — an avatar, a
 * mono stamp, a band divider, the toast the card raises when you act while
 * signed out — and all three panes need the same ones to read as one design.
 */

import Image from "next/image";
import { useEffect } from "react";
import { AlertCircle, Check, X } from "lucide-react";

export function initialOf(name: string | null | undefined): string {
  return (name ?? "").trim().charAt(0).toUpperCase() || "?";
}

const AVATAR_SIZES = {
  sm: { px: 30, cls: "w-[30px] h-[30px] text-[12px]" },
  md: { px: 36, cls: "w-9 h-9 text-sm" },
  lg: { px: 38, cls: "w-[38px] h-[38px] text-[15px]" },
} as const;

export function PersonAvatar({
  name,
  image,
  size = "md",
  square = false,
}: {
  name: string | null | undefined;
  image?: string | null;
  size?: keyof typeof AVATAR_SIZES;
  /** Organisations read as rounded squares, people as circles. */
  square?: boolean;
}) {
  const { px, cls } = AVATAR_SIZES[size];
  const shape = square ? "rounded-lg" : "rounded-full";

  if (image) {
    return (
      <Image
        src={image}
        alt={name ?? ""}
        width={px}
        height={px}
        unoptimized
        className={`${cls} ${shape} shrink-0 object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${cls} ${shape} grid shrink-0 place-items-center bg-accent-primary font-bold text-white`}
    >
      {initialOf(name)}
    </span>
  );
}

/** An uppercase mono label: section headings, meta rows, status chips. */
export function Stamp({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`kairos-stamp text-[10px] text-fg-tertiary ${className}`}>
      {children}
    </span>
  );
}

/** A card shell — one border radius and one surface for the whole page. */
export function Panel({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white dark:border-white/5 dark:bg-[#0e0e14] ${
        padded ? "p-4" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A panel with its own titled header row. */
export function TitledPanel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel padded={false} className={`overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-white/[0.06]">
        <h2 className="text-[13px] font-semibold text-fg-primary">{title}</h2>
        {aside}
      </div>
      {children}
    </Panel>
  );
}

/**
 * The rule between feed bands. `accent` marks the band you are meant to read
 * first; the other fades to a plain hairline so the two do not compete.
 */
export function BandDivider({
  label,
  accent = false,
}: {
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`kairos-stamp text-[10px] tracking-[0.16em] ${
          accent ? "text-accent-primary" : "text-fg-tertiary"
        }`}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className={`h-px flex-1 ${
          accent
            ? "bg-gradient-to-r from-accent-primary/45 to-transparent"
            : "bg-slate-200 dark:bg-white/10"
        }`}
      />
    </div>
  );
}

/** A read-only fact chip: date, place, audience. */
export function MetaChip({
  icon,
  children,
  dashed = false,
  onClick,
  title,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  dashed?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const shell = `flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs ${
    dashed
      ? "border border-dashed border-slate-300 text-fg-tertiary dark:border-white/15"
      : "border border-slate-200 bg-slate-50 text-fg-secondary dark:border-white/10 dark:bg-white/5"
  }`;

  if (!onClick) {
    return (
      <span className={shell} title={title}>
        {icon}
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${shell} transition-colors hover:border-accent-primary/40 hover:text-accent-primary`}
    >
      {icon}
      {children}
    </button>
  );
}

export interface InfoMessage {
  message: string;
  type: "error" | "info";
}

/** The transient acknowledgement a card raises for its own actions. */
export function InfoToast({
  info,
  onClose,
}: {
  info: InfoMessage | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [info, onClose]);

  if (!info) return null;

  const tone =
    info.type === "error"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
      : "border-slate-200 bg-white text-fg-primary dark:border-white/10 dark:bg-[#16151A]";
  const Icon = info.type === "error" ? AlertCircle : Check;

  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border p-4 shadow-lg ${tone}`}
    >
      <Icon size={18} className="shrink-0" />
      <p className="text-sm font-medium">{info.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="kairos-tap rounded-full p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
      >
        <X size={14} />
      </button>
    </div>
  );
}
