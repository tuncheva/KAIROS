"use client";

import { Lock, Plus } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import {
  KIND_GLYPH,
  groupByDay,
  isSameDay,
  itemUid,
  toHm,
  toneFor,
  type CalendarItem,
} from "./calendarModel";

type Props = {
  items: CalendarItem[];
  today: Date;
  listLabel: string;
  todayLabel: string;
  untimedLabel: string;
  addLabel: string;
  dayHeading: (date: Date) => string;
  itemMeta: (item: CalendarItem) => string;
  describeItem: (item: CalendarItem) => string;
  countLabel: (count: number) => string;
  onSelectItem: (item: CalendarItem) => void;
  onCreate: (date: Date) => void;
};

/**
 * The period as a list, grouped by day.
 *
 * This is the phone default. A week grid at 375px gives each day 53px, which
 * is why the grids carried `min-w-[760px]` and panned the entire calendar
 * sideways — reflow is a hard requirement, and a calendar on a phone wants a
 * list rather than a spreadsheet you drag.
 *
 * It consumes the same already-filtered item set the grids do, so there is no
 * second data path and no second filter implementation to keep in step.
 */
export function CalendarAgenda({
  items,
  today,
  listLabel,
  todayLabel,
  untimedLabel,
  addLabel,
  dayHeading,
  itemMeta,
  describeItem,
  countLabel,
  onSelectItem,
  onCreate,
}: Props) {
  const groups = groupByDay(items);

  return (
    <div
      className="kairos-scroll-area flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-border-light bg-bg-elevated calendar-fade"
      role="list"
      aria-label={listLabel}
    >
      {groups.map(({ day, items: dayItems }) => {
        const isToday = isSameDay(day, today);
        return (
          <section key={day.getTime()} role="listitem" className="border-b border-border-light last:border-b-0">
            {/* Sticky, so scrolling a long agenda never loses which day you
                are looking at. */}
            <header
              className={cn(
                "sticky top-0 z-10 flex items-baseline gap-2 border-b border-border-light/70 px-4 py-2 backdrop-blur",
                isToday ? "bg-accent-primary/[0.09]" : "bg-bg-surface/95",
              )}
            >
              <h3
                className={cn(
                  "text-[13px] font-semibold tracking-tight",
                  isToday ? "text-accent-primary" : "text-fg-primary",
                )}
              >
                {isToday ? `${todayLabel} · ${dayHeading(day)}` : dayHeading(day)}
              </h3>
              <span className="text-[10px] tabular-nums text-fg-tertiary">
                {countLabel(dayItems.length)}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => onCreate(day)}
                aria-label={addLabel}
                title={addLabel}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-medium text-fg-tertiary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
              >
                <Plus size={12} />
              </button>
            </header>

            <ul className="flex flex-col">
              {dayItems.map((item) => {
                const tone = toneFor(item);
                const completed = item.kind === "task" && item.status === "completed";
                return (
                  <li key={itemUid(item)}>
                    {/* The whole row is the target, not a chip inside it, and
                        it clears 44px. */}
                    <button
                      type="button"
                      onClick={() => onSelectItem(item)}
                      aria-label={describeItem(item)}
                      className="flex min-h-[44px] w-full items-stretch gap-3 border-b border-border-light/40 px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-bg-secondary/60"
                    >
                      <span
                        aria-hidden="true"
                        className="w-[3.2em] shrink-0 pt-[2px] text-[11px] tabular-nums text-fg-tertiary"
                      >
                        {item.allDay ? untimedLabel : toHm(item.date)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn("w-[3px] shrink-0 rounded-sm", tone.bar)}
                      />
                      <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col justify-center">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={cn("shrink-0 text-[9px] leading-none font-bold", tone.text)}>
                            {KIND_GLYPH[item.kind]}
                          </span>
                          <span
                            className={cn(
                              "truncate text-[13px] font-semibold text-fg-primary",
                              completed && "text-fg-tertiary line-through",
                            )}
                          >
                            {item.title}
                          </span>
                          {item.kind === "note" && item.locked && (
                            <Lock size={11} className="shrink-0 text-fg-tertiary" />
                          )}
                        </span>
                        <span className="truncate text-[11px] text-fg-tertiary">{itemMeta(item)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
