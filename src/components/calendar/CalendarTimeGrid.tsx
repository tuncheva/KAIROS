"use client";

import { Lock, Plus } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import {
  ROW_HEIGHT,
  dayKey,
  decimalHours,
  isSameDay,
  itemUid,
  layoutTimedItems,
  pad2,
  toHm,
  toneFor,
  type CalendarItem,
} from "./calendarModel";

type Props = {
  days: Date[];
  today: Date;
  /** Wall-clock time on the client, for the now-line. */
  now: Date;
  itemsByDay: Map<string, CalendarItem[]>;
  hours: { start: number; end: number };
  weekdayLabel: (date: Date) => string;
  allDayLabel: string;
  addLabel: string;
  countLabel: (count: number) => string;
  onSelectItem: (item: CalendarItem) => void;
  onCreate: (date: Date) => void;
};

const GUTTER = "w-[58px]";

export function CalendarTimeGrid({
  days,
  today,
  now,
  itemsByDay,
  hours,
  weekdayLabel,
  allDayLabel,
  addLabel,
  countLabel,
  onSelectItem,
  onCreate,
}: Props) {
  const hourList = Array.from({ length: hours.end - hours.start }, (_, i) => hours.start + i);
  const columns = days.map((day) => {
    const items = itemsByDay.get(dayKey(day)) ?? [];
    return {
      day,
      isToday: isSameDay(day, today),
      allDay: items.filter((item) => item.allDay),
      timed: layoutTimedItems(
        items.filter((item) => !item.allDay),
        hours.start,
      ),
      count: items.length,
    };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-elevated calendar-fade">
      {/* Column headers */}
      <div className="flex shrink-0 border-b border-border-light">
        <div className={cn(GUTTER, "shrink-0")} />
        {columns.map((column) => (
          <div
            key={column.day.getTime()}
            className={cn(
              "group flex min-w-0 flex-1 items-center gap-2 border-l border-border-light/70 px-3 py-2.5 transition-colors",
              column.isToday ? "bg-accent-primary/[0.08]" : "hover:bg-bg-secondary/40",
            )}
          >
            <span
              className={cn(
                "text-[10px] uppercase tracking-[0.14em]",
                column.isToday ? "text-accent-primary" : "text-fg-tertiary",
              )}
            >
              {weekdayLabel(column.day)}
            </span>
            <span
              className={cn(
                "text-base font-semibold tabular-nums",
                column.isToday ? "text-accent-primary" : "text-fg-primary",
              )}
            >
              {column.day.getDate()}
            </span>
            <span className="text-[10px] tabular-nums text-fg-tertiary">
              {countLabel(column.count)}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => onCreate(column.day)}
              aria-label={addLabel}
              title={addLabel}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-border-medium bg-bg-secondary/80 text-fg-secondary opacity-0 transition-opacity hover:text-fg-primary focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Plus size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* All-day strip */}
      <div className="flex shrink-0 border-b border-border-light bg-bg-secondary/40">
        <div
          className={cn(
            GUTTER,
            "flex shrink-0 items-center justify-end pr-2.5 text-[9px] uppercase tracking-[0.1em] text-fg-tertiary",
          )}
        >
          {allDayLabel}
        </div>
        {columns.map((column) => (
          <div
            key={column.day.getTime()}
            className="flex min-h-[38px] min-w-0 flex-1 flex-col gap-1 border-l border-border-light/70 p-1.5"
          >
            {column.allDay.map((item) => {
              const tone = toneFor(item);
              return (
                <button
                  key={itemUid(item)}
                  type="button"
                  onClick={() => onSelectItem(item)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-transform hover:-translate-y-px",
                    tone.bg,
                    tone.border,
                  )}
                >
                  <span className={cn("h-3 w-[3px] shrink-0 rounded-sm", tone.bar)} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[11px] font-medium",
                      item.kind === "note" ? "text-fg-secondary" : "text-fg-primary",
                      item.kind === "task" && item.status === "completed" && "line-through",
                    )}
                  >
                    {item.title}
                  </span>
                  {item.kind === "note" && item.locked && (
                    <Lock size={10} className="shrink-0 text-fg-tertiary" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Hour grid */}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className={cn(GUTTER, "relative shrink-0")}>
          {hourList.map((hour) => (
            <div
              key={hour}
              style={{ height: ROW_HEIGHT }}
              className="-translate-y-[5px] pr-2.5 text-right text-[10px] tabular-nums text-fg-tertiary"
            >
              {pad2(hour)}:00
            </div>
          ))}
        </div>

        {columns.map((column) => {
          const nowTop = Math.round((decimalHours(now) - hours.start) * ROW_HEIGHT);
          const showNow =
            column.isToday &&
            nowTop >= 0 &&
            nowTop <= (hours.end - hours.start) * ROW_HEIGHT;

          return (
            <div
              key={column.day.getTime()}
              className={cn(
                "relative min-w-0 flex-1 border-l border-border-light/70 transition-colors",
                column.isToday ? "bg-accent-primary/[0.03]" : "hover:bg-bg-secondary/30",
              )}
            >
              {hourList.map((hour) => (
                <div
                  key={hour}
                  style={{ height: ROW_HEIGHT }}
                  className="border-t border-border-light/50"
                />
              ))}

              {showNow && (
                <div
                  className="pointer-events-none absolute right-0 left-0 h-px bg-error"
                  style={{ top: nowTop }}
                >
                  <span className="absolute -top-[3px] left-0 h-[7px] w-[7px] rounded-full bg-error" />
                </div>
              )}

              {column.timed.map(({ item, top, height, lane, lanes }) => {
                const tone = toneFor(item);
                const width = `calc((100% - 8px) / ${lanes})`;
                return (
                  <button
                    key={itemUid(item)}
                    type="button"
                    onClick={() => onSelectItem(item)}
                    style={{
                      top,
                      height,
                      left: `calc(4px + ${lane} * ${width})`,
                      width,
                    }}
                    className={cn(
                      "absolute flex flex-col gap-0.5 overflow-hidden rounded-md border py-1.5 pr-2 pl-2.5 text-left transition-[transform,box-shadow] duration-300 hover:-translate-y-px hover:shadow-lg",
                      tone.bg,
                      tone.border,
                    )}
                  >
                    <span className={cn("absolute top-0 bottom-0 left-0 w-[3px]", tone.bar)} />
                    <span
                      className={cn(
                        "truncate text-xs leading-tight font-semibold",
                        item.kind === "note" ? "text-fg-secondary" : "text-fg-primary",
                        item.kind === "task" && item.status === "completed" && "line-through",
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="truncate text-[10px] tabular-nums text-fg-tertiary">
                      {toHm(item.date)}
                      {item.kind === "task" && item.projectTitle ? ` · ${item.projectTitle}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
