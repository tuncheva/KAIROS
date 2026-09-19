"use client";

import { useRef } from "react";
import { Plus } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import { CalendarItemChip } from "./CalendarItemChip";
import { useRoving, useRovingFocus } from "./useCalendarA11y";
import { dayKey, isSameDay, itemUid, type CalendarItem } from "./calendarModel";

/** Three, not two. The fourth line in a cell is the overflow button, which is
 *  now a real control rather than a count you could not press. */
const VISIBLE_PER_CELL = 3;

type Props = {
  days: Date[];
  /** Month the grid is anchored to — days outside it recede. */
  month: number;
  today: Date;
  itemsByDay: Map<string, CalendarItem[]>;
  weekdayLabels: string[];
  /** Long weekday names, for the column headers' accessible text. */
  weekdayLongLabels: string[];
  gridLabel: string;
  moreLabel: (count: number) => string;
  addLabel: string;
  /** Full accessible name for a cell: date plus what is on it. */
  dayLabel: (date: Date, count: number) => string;
  describeItem: (item: CalendarItem) => string;
  /** Index into `days` that owns the grid's single tab stop. */
  focusedIndex: number;
  onFocusedIndexChange: (index: number) => void;
  onOpenDay: (date: Date) => void;
  onSelectItem: (item: CalendarItem) => void;
  onCreate: (date: Date) => void;
};

export function CalendarMonthGrid({
  days,
  month,
  today,
  itemsByDay,
  weekdayLabels,
  weekdayLongLabels,
  gridLabel,
  moreLabel,
  addLabel,
  dayLabel,
  describeItem,
  focusedIndex,
  onFocusedIndexChange,
  onOpenDay,
  onSelectItem,
  onCreate,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useRoving({
    count: days.length,
    columns: 7,
    index: focusedIndex,
    onIndexChange: onFocusedIndexChange,
    onActivate: (index) => {
      const day = days[index];
      if (day) onOpenDay(day);
    },
  });

  useRovingFocus(gridRef, '[data-roving="true"]', focusedIndex);

  /* role="grid" wants rows. The month is held as a flat 42-day array because
     every other consumer wants it that way, so chunk it here rather than
     changing the model's shape. */
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={gridLabel}
      aria-rowcount={weeks.length + 1}
      aria-colcount={7}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-elevated animate-[fadeIn_400ms_ease-out]"
    >
      <div role="row" aria-rowindex={1} className="grid shrink-0 grid-cols-7 border-b border-border-light">
        {weekdayLabels.map((label, i) => (
          <div
            key={label}
            role="columnheader"
            aria-colindex={i + 1}
            className="px-3 py-2.5 text-[11px] uppercase tracking-[0.12em] text-fg-tertiary"
          >
            {/* Short label on screen, full weekday for anything reading it. */}
            <span aria-hidden="true">{label}</span>
            <span className="sr-only">{weekdayLongLabels[i] ?? label}</span>
          </div>
        ))}
      </div>

      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" aria-rowindex={weekIndex + 2} className="col-span-7 grid grid-cols-7">
            {week.map((day, columnIndex) => {
              const index = weekIndex * 7 + columnIndex;
              const inMonth = day.getMonth() === month;
              const isToday = isSameDay(day, today);
              const items = itemsByDay.get(dayKey(day)) ?? [];
              const hidden = items.length - VISIBLE_PER_CELL;
              const isFocused = index === focusedIndex;

              return (
                <div
                  key={day.getTime()}
                  role="gridcell"
                  aria-colindex={columnIndex + 1}
                  aria-label={dayLabel(day, items.length)}
                  aria-selected={isFocused}
                  data-roving={isFocused ? "true" : undefined}
                  tabIndex={isFocused ? 0 : -1}
                  onFocus={() => onFocusedIndexChange(index)}
                  onClick={(event) => {
                    // Only a press on the cell's own empty space opens the day;
                    // a press on a chip or the add button is that control's.
                    if (event.target === event.currentTarget) onOpenDay(day);
                  }}
                  className={cn(
                    "group relative flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden border-r border-b border-border-light/60 p-2 transition-colors outline-none",
                    // Dimming lives on the fill, not on opacity. `opacity-40`
                    // multiplied against already-tertiary text and put the
                    // leading and trailing weeks under 3:1 in both themes.
                    !inMonth && "bg-bg-secondary/60",
                    isToday && "bg-accent-primary/[0.07]",
                    !isToday && inMonth && "hover:bg-bg-secondary/50",
                    "focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-inset",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
                        isToday
                          ? "bg-accent-primary text-white"
                          : inMonth
                            ? "text-fg-primary"
                            : "text-fg-tertiary",
                      )}
                    >
                      {day.getDate()}
                    </span>

                    {/* Visible at rest. It used to be `opacity-0` until hover,
                        which meant it never appeared at all on touch — where
                        there is no hover — while still sitting in the tab
                        order at all forty-two cells. Keyboard route is `n`,
                        or "Add here" inside the day peek. */}
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onCreate(day)}
                      aria-label={addLabel}
                      title={addLabel}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border-medium bg-bg-secondary/80 text-fg-tertiary transition-colors hover:text-fg-primary group-hover:border-border-strong"
                    >
                      <Plus size={11} />
                    </button>
                  </div>

                  {items.slice(0, VISIBLE_PER_CELL).map((item) => (
                    <CalendarItemChip
                      key={itemUid(item)}
                      item={item}
                      label={describeItem(item)}
                      tabIndex={-1}
                      onSelect={() => onSelectItem(item)}
                    />
                  ))}

                  {hidden > 0 && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onOpenDay(day)}
                      className="self-start rounded-sm border border-dashed border-accent-primary/40 px-1.5 py-[1px] text-[10px] font-semibold text-accent-primary transition-colors hover:bg-accent-primary/10"
                    >
                      {moreLabel(hidden)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
