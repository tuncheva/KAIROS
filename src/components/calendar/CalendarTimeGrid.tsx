"use client";

import { useRef } from "react";
import { Plus } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import { CalendarItemChip } from "./CalendarItemChip";
import { useRoving, useRovingFocus } from "./useCalendarA11y";
import {
  KIND_GLYPH,
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
  gridLabel: string;
  allDayLabel: string;
  addLabel: string;
  dayLabel: (date: Date, count: number) => string;
  /** "Add at 14:00 on Thursday" — the empty-hour target's name. */
  slotLabel: (date: Date, hour: number) => string;
  nowLabel: (time: string) => string;
  countLabel: (count: number) => string;
  describeItem: (item: CalendarItem) => string;
  focusedIndex: number;
  onFocusedIndexChange: (index: number) => void;
  onOpenDay: (date: Date) => void;
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
  gridLabel,
  allDayLabel,
  addLabel,
  dayLabel,
  slotLabel,
  nowLabel,
  countLabel,
  describeItem,
  focusedIndex,
  onFocusedIndexChange,
  onOpenDay,
  onSelectItem,
  onCreate,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);

  /* One row of days, so the roving set is linear even though the grid looks
     two-dimensional: up and down inside a day column means "earlier and later
     today", which the hour rows are not focusable for. Left and right move
     between days, which is what the arrows are for here. */
  const onKeyDown = useRoving({
    count: days.length,
    columns: days.length || 1,
    index: focusedIndex,
    onIndexChange: onFocusedIndexChange,
    onActivate: (index) => {
      const day = days[index];
      if (day) onOpenDay(day);
    },
  });

  useRovingFocus(gridRef, '[data-roving="true"]', focusedIndex);

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

  /* The now-line is a rule across today's column *and* a time pill in the
     gutter, so the exact minute is readable without hovering a bare coloured
     div. The gutter is a sibling of the columns rather than their parent, so
     the offset both sides position against is computed once, here. */
  const nowTop = Math.round((decimalHours(now) - hours.start) * ROW_HEIGHT);
  const nowInRange = nowTop >= 0 && nowTop <= (hours.end - hours.start) * ROW_HEIGHT;
  const showNowPill = nowInRange && columns.some((column) => column.isToday);
  /* Each hour label's own centre line, so the one the timestamp would sit on
     top of can step aside instead of showing through around its corners. */
  const hourLabelHidden = (hour: number) =>
    showNowPill && Math.abs(nowTop - ((hour - hours.start) * ROW_HEIGHT + 10)) < 15;

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={gridLabel}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-elevated calendar-fade"
    >
      {/* One scroller for the whole grid, with the day headers and the
         all-day strip stuck to its top.

         They used to sit outside the scrolling hour area, which meant only
         the hour area carried the vertical scrollbar. A scrollbar is ~15px
         of the content box, so its seven `flex-1` columns were each ~2px
         narrower than the seven header cells above them, and the gridlines
         drifted further left with every column — 13px out by Sunday, which
         read as the last day being wider than the rest.

         Inside one scroller all three share a single content width, so the
         columns line up by construction whether or not a scrollbar is
         present, and on whatever width it happens to be. */}
      <div className="kairos-scroll-area flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Opaque, so the hour rows scroll underneath rather than through. */}
        <div className="sticky top-0 z-20 shrink-0 bg-bg-elevated">
          {/* Column headers — the roving day cells live here, because this is the
              one row that exists in every one of these views. */}
          <div role="row" className="flex shrink-0 border-b border-border-light">
            <div className={cn(GUTTER, "shrink-0")} aria-hidden="true" />
            {columns.map((column, index) => {
              const isFocused = index === focusedIndex;
              return (
                <div
                  key={column.day.getTime()}
                  role="columnheader"
                  aria-label={dayLabel(column.day, column.count)}
                  aria-selected={isFocused}
                  data-roving={isFocused ? "true" : undefined}
                  tabIndex={isFocused ? 0 : -1}
                  onFocus={() => onFocusedIndexChange(index)}
                  onClick={(event) => {
                    if (event.target === event.currentTarget) onOpenDay(column.day);
                  }}
                  className={cn(
                    "group flex min-w-0 flex-1 items-center gap-2 border-l border-border-light/70 px-3 py-2.5 transition-colors outline-none",
                    column.isToday ? "bg-now-line/[0.06]" : "hover:bg-bg-secondary/40",
                    "focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-inset",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "text-[11px] uppercase tracking-[0.12em]",
                      column.isToday ? "text-now-line" : "text-fg-tertiary",
                    )}
                  >
                    {weekdayLabel(column.day)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "text-base font-semibold tabular-nums",
                      column.isToday ? "text-now-line" : "text-fg-primary",
                    )}
                  >
                    {column.day.getDate()}
                  </span>
                  <span aria-hidden="true" className="text-[10px] tabular-nums text-fg-tertiary">
                    {countLabel(column.count)}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onCreate(column.day)}
                    aria-label={addLabel}
                    title={addLabel}
                    className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-border-medium bg-bg-secondary/80 text-fg-tertiary transition-colors hover:text-fg-primary group-hover:border-border-strong"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* All-day strip */}
          <div role="row" className="flex shrink-0 border-b border-border-light bg-bg-secondary/40">
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
                role="gridcell"
                className="flex min-h-[38px] min-w-0 flex-1 flex-col gap-1 border-l border-border-light/70 p-1.5"
              >
                {column.allDay.map((item) => (
                  <CalendarItemChip
                    key={itemUid(item)}
                    item={item}
                    label={describeItem(item)}
                    tabIndex={-1}
                    showTime={false}
                    className="rounded-md px-2 py-1"
                    onSelect={() => onSelectItem(item)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Hour grid */}
        <div className="flex flex-1">
          {/* The gutter's rows must have the *same box model* as a day column's
              rows, or the labels drift away from the lines they name.

              They used to be plain 56px boxes nudged up 5px so the text would
              straddle its gridline. Two things went wrong with that. The day
              rows carry `border-t`, so a column row is 56px including a 1px
              border while a gutter row was 56px of nothing — the two stacks only
              happened to agree because `box-sizing: border-box` absorbs the
              border. And the nudge pulled the first label above the top of the
              scroll container, where it was clipped and crossed into the all-day
              strip above it.

              So: an identical 56px row with an identical 1px top border, just
              transparent, and the label sits *inside* the hour it names rather
              than straddling the boundary. Alignment is now structural — both
              sides put row `i`'s line at exactly `i * ROW_HEIGHT` — instead of
              resting on an offset that has to be re-tuned whenever the type
              size changes. */}
          <div className={cn(GUTTER, "relative shrink-0")} aria-hidden="true">
            {hourList.map((hour) => (
              <div
                key={hour}
                style={{ height: ROW_HEIGHT }}
                className={cn(
                  "border-t border-transparent pt-1 pr-2.5 text-right text-[10px] leading-none tabular-nums text-fg-tertiary transition-opacity",
                  hourLabelHidden(hour) && "opacity-0",
                )}
              >
                {pad2(hour)}:00
              </div>
            ))}

            {showNowPill && (
              <span
                className="absolute right-1.5 -translate-y-1/2 rounded-sm bg-now-line px-[7px] py-[3.5px] text-[10px] font-semibold leading-none tabular-nums text-white ring-1 ring-bg-elevated shadow-[0_1px_4px_rgb(var(--now-line)/0.4)]"
                style={{ top: nowTop }}
              >
                {toHm(now)}
              </span>
            )}
          </div>

          {columns.map((column) => {
            const showNow = column.isToday && nowInRange;

            return (
              <div
                key={column.day.getTime()}
                role="gridcell"
                className={cn(
                  "relative min-w-0 flex-1 border-l border-border-light/70 transition-colors",
                  column.isToday ? "bg-now-line/[0.025]" : "hover:bg-bg-secondary/30",
                )}
              >
                {/* Empty hours are creation targets. Clicking 14:00 used to do
                    nothing at all, and the only way in — the header's plus —
                    seeded the form with a hardcoded 09:00 whatever hour you
                    were aiming at. */}
                {hourList.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    tabIndex={-1}
                    aria-label={slotLabel(column.day, hour)}
                    onClick={() => {
                      const at = new Date(column.day);
                      at.setHours(hour, 0, 0, 0);
                      onCreate(at);
                    }}
                    style={{ height: ROW_HEIGHT }}
                    className="group/slot block w-full border-t border-border-light/50 transition-colors hover:bg-accent-primary/[0.06]"
                  >
                    <Plus
                      size={12}
                      className="mx-auto text-fg-quaternary opacity-0 transition-opacity group-hover/slot:opacity-100"
                    />
                  </button>
                ))}

                {showNow && (
                  <div className="pointer-events-none absolute right-0 left-0 z-10" style={{ top: nowTop }}>
                    {/* A hairline growing out of the gutter's timestamp, fading
                        across the day so it marks the minute without competing
                        with the event chips it crosses. */}
                    <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-now-line via-now-line/45 to-now-line/10" />
                    {/* The one live element on the page used to be a bare
                        coloured div — no text equivalent at all. */}
                    <span className="sr-only">{nowLabel(toHm(now))}</span>
                  </div>
                )}

                {column.timed.map(({ item, top, height, lane, lanes, endKnown }) => {
                  const tone = toneFor(item);
                  const width = `calc((100% - 8px) / ${lanes})`;
                  const completed = item.kind === "task" && item.status === "completed";
                  const tight = height < 34;

                  return (
                    <button
                      key={itemUid(item)}
                      type="button"
                      tabIndex={-1}
                      aria-label={describeItem(item)}
                      onClick={() => onSelectItem(item)}
                      style={{
                        top,
                        height,
                        left: `calc(4px + ${lane} * ${width})`,
                        width,
                        // An assumed length must not read as a recorded one, so
                        // an event with no `ends_at` gets an open lower edge.
                        // Tailwind's `border-dashed` is all-sides, hence inline.
                        ...(endKnown ? null : { borderBottomStyle: "dashed" as const }),
                      }}
                      className={cn(
                        "absolute flex flex-col overflow-hidden rounded-md border pr-2 pl-2.5 text-left transition-[transform,box-shadow] duration-300 hover:-translate-y-px hover:shadow-lg",
                        tight ? "justify-center py-0" : "gap-0.5 py-1.5",
                        tone.bg,
                        tone.border,
                      )}
                    >
                      <span className={cn("absolute top-0 bottom-0 left-0 w-[3px]", tone.bar)} aria-hidden="true" />
                      <span aria-hidden="true" className="flex min-w-0 items-center gap-1">
                        <span className={cn("shrink-0 text-[9px] leading-none font-bold", tone.text)}>
                          {KIND_GLYPH[item.kind]}
                        </span>
                        <span
                          className={cn(
                            "truncate text-xs leading-tight font-semibold",
                            item.kind === "note" ? "text-fg-secondary" : "text-fg-primary",
                            completed && "line-through",
                          )}
                        >
                          {item.title}
                        </span>
                      </span>
                      {!tight && (
                        <span aria-hidden="true" className="truncate text-[10px] tabular-nums text-fg-tertiary">
                          {toHm(item.date)}
                          {item.kind === "event" && item.endsAt ? `–${toHm(item.endsAt)}` : ""}
                          {item.kind === "task" && item.projectTitle ? ` · ${item.projectTitle}` : ""}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
