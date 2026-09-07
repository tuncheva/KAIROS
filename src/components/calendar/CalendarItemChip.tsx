"use client";

import { Lock } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import { KIND_GLYPH, toHm, toneFor, type CalendarItem } from "./calendarModel";

type Props = {
  item: CalendarItem;
  /** Full spoken name — kind, title, time, state. Built by the caller, which
   *  is where the translations live. */
  label: string;
  tabIndex?: number;
  showTime?: boolean;
  className?: string;
  onSelect: () => void;
};

/**
 * One item, as it appears inside a day.
 *
 * Shared by the month grid, the all-day strip and the day peek so kind reads
 * the same everywhere. Kind is carried three ways — glyph, tint and the left
 * bar — because it used to be carried only by tint, which disappears in
 * greyscale, at low vision, or when the user's chosen accent lands on the same
 * hue as a task priority.
 */
export function CalendarItemChip({
  item,
  label,
  tabIndex,
  showTime = true,
  className,
  onSelect,
}: Props) {
  const tone = toneFor(item);
  const completed = item.kind === "task" && item.status === "completed";

  return (
    <button
      type="button"
      tabIndex={tabIndex}
      onClick={onSelect}
      aria-label={label}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded border px-1.5 py-[3px] text-left transition-transform hover:translate-x-0.5",
        tone.bg,
        tone.border,
        className,
      )}
    >
      <span className={cn("h-[11px] w-[3px] shrink-0 rounded-sm", tone.bar)} aria-hidden="true" />
      <span
        aria-hidden="true"
        className={cn("shrink-0 text-[9px] leading-none font-bold", tone.text)}
      >
        {KIND_GLYPH[item.kind]}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "min-w-0 flex-1 truncate text-[11px] font-medium",
          item.kind === "note" ? "text-fg-secondary" : "text-fg-primary",
          completed && "line-through",
        )}
      >
        {item.title}
      </span>
      {showTime && !item.allDay && (
        <span aria-hidden="true" className="shrink-0 text-[10px] tabular-nums text-fg-tertiary">
          {toHm(item.date)}
        </span>
      )}
      {item.kind === "note" && item.locked && (
        <Lock size={10} className="shrink-0 text-fg-tertiary" aria-hidden="true" />
      )}
    </button>
  );
}
