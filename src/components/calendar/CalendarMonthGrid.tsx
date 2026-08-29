"use client";

import { Plus } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import {
  dayKey,
  isSameDay,
  itemUid,
  toneFor,
  type CalendarItem,
} from "./calendarModel";

const VISIBLE_PER_CELL = 2;

type Props = {
  days: Date[];
  /** Month the grid is anchored to — days outside it are dimmed. */
  month: number;
  today: Date;
  itemsByDay: Map<string, CalendarItem[]>;
  weekdayLabels: string[];
  moreLabel: (count: number) => string;
  addLabel: string;
  onSelectItem: (item: CalendarItem) => void;
  onCreate: (date: Date) => void;
};

export function CalendarMonthGrid({
  days,
  month,
  today,
  itemsByDay,
  weekdayLabels,
  moreLabel,
  addLabel,
  onSelectItem,
  onCreate,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-elevated animate-[fadeIn_400ms_ease-out]">
      <div className="grid shrink-0 grid-cols-7 border-b border-border-light">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-fg-tertiary"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {days.map((day) => {
          const inMonth = day.getMonth() === month;
          const isToday = isSameDay(day, today);
          const items = itemsByDay.get(dayKey(day)) ?? [];
          const hidden = items.length - VISIBLE_PER_CELL;

          return (
            <div
              key={day.getTime()}
              className={cn(
                "group relative flex min-h-0 flex-col gap-1.5 overflow-hidden border-r border-b border-border-light/60 p-2 transition-colors",
                !inMonth && "opacity-40",
                isToday ? "bg-accent-primary/[0.07]" : "hover:bg-bg-secondary/50",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    isToday ? "bg-accent-primary text-white" : "text-fg-primary",
                  )}
                >
                  {day.getDate()}
                </span>

                {inMonth && (
                  <button
                    type="button"
                    onClick={() => onCreate(day)}
                    aria-label={addLabel}
                    title={addLabel}
                    className="flex h-5 w-5 items-center justify-center rounded-md border border-border-medium bg-bg-secondary/80 text-fg-secondary opacity-0 transition-opacity hover:text-fg-primary focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Plus size={11} />
                  </button>
                )}
              </div>

              {items.slice(0, VISIBLE_PER_CELL).map((item) => {
                const tone = toneFor(item);
                return (
                  <button
                    key={itemUid(item)}
                    type="button"
                    onClick={() => onSelectItem(item)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded border px-1.5 py-[3px] text-left transition-transform hover:translate-x-0.5",
                      tone.bg,
                      tone.border,
                    )}
                  >
                    <span className={cn("h-[11px] w-[3px] shrink-0 rounded-sm", tone.bar)} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[11px] font-medium",
                        item.kind === "note" ? "text-fg-secondary" : "text-fg-primary",
                        item.kind === "task" && item.status === "completed" && "line-through",
                      )}
                    >
                      {item.title}
                    </span>
                  </button>
                );
              })}

              {hidden > 0 && (
                <span className="pl-1.5 text-[10px] text-fg-tertiary">
                  {moreLabel(hidden)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
