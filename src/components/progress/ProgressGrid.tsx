"use client";

import { useState } from "react";
import { cn } from "~/lib/utils";
import { HEAT_LEGEND, heatClass, type GridWeek } from "./progressModel";

/** Cell edge and gap, in pixels, per size. `sm` is the member drawer's strip. */
const SIZES = {
  lg: { cell: 16, gap: 4, radius: "rounded-[3px]" },
  sm: { cell: 13, gap: 3, radius: "rounded-[3px]" },
} as const;
/** Width of the weekday gutter, when it is shown. */
const GUTTER = 30;

type Props = {
  weeks: GridWeek[];
  size?: keyof typeof SIZES;
  selectedYmd?: string | null;
  /** Omitted, the grid is a picture: no buttons, no caption, nothing to tab to. */
  onSelect?: (ymd: string) => void;
  /** Mon/Wed/Fri gutter — the page has room for it, the drawer does not. */
  showWeekdays?: boolean;
  weekdayLabels?: { monday: string; wednesday: string; friday: string };
  formatMonth: (date: Date) => string;
  formatDay: (date: Date) => string;
  labels: {
    less: string;
    more: string;
    /** Shown until the reader points at a day. */
    hint: string;
    dayCount: (day: string, count: number) => string;
  };
};

export function ProgressGrid({
  weeks,
  size = "lg",
  selectedYmd = null,
  onSelect,
  showWeekdays = false,
  weekdayLabels,
  formatMonth,
  formatDay,
  labels,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { cell, gap, radius } = SIZES[size];
  const interactive = !!onSelect;

  const gutter = showWeekdays && weekdayLabels ? GUTTER : 0;
  // Rows are Monday-first; only every other one is named, so the gutter
  // stays readable at this row height.
  const rowNames = weekdayLabels
    ? [weekdayLabels.monday, "", weekdayLabels.wednesday, "", weekdayLabels.friday, "", ""]
    : [];

  const hoveredDay = hovered
    ? weeks.flatMap((w) => w.days).find((d) => d.ymd === hovered)
    : null;

  const caption = hoveredDay
    ? labels.dayCount(formatDay(hoveredDay.date), hoveredDay.count)
    : labels.hint;

  return (
    <div className="flex flex-col gap-3">
      {/* The selection ring and hover zoom reach a few pixels past a cell; the
          padding keeps the scroller from clipping them at the edges, and the
          negative margin keeps the grid where it was. */}
      <div className="-m-1 overflow-x-auto p-1" onMouseLeave={() => setHovered(null)}>
        <div className="flex w-max flex-col gap-2.5">
          {/* Month ticks. Each column is a cell wide plus its gap, so a label
              placed on a column lines up with the week it names. */}
          <div className="flex" style={{ gap, paddingLeft: gutter ? gutter + gap : 0 }}>
            {weeks.map((week) => (
              <span
                key={week.key}
                className="text-tui-ink3 text-[10.5px] whitespace-nowrap tabular-nums"
                style={{ width: cell }}
              >
                {week.monthLabel ? formatMonth(week.monthLabel) : ""}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap }}>
            {gutter > 0 && (
              <div
                className="flex shrink-0 flex-col"
                style={{ width: gutter, gap }}
                aria-hidden="true"
              >
                {Array.from({ length: 7 }, (_, row) => (
                  <span
                    key={row}
                    className="text-tui-ink3 flex items-center text-[10px]"
                    style={{ height: cell }}
                  >
                    {rowNames[row] ?? ""}
                  </span>
                ))}
              </div>
            )}

            {weeks.map((week) => (
              <div key={week.key} className="flex flex-col" style={{ gap }}>
                {week.days.map((day) => {
                  if (day.isFuture) {
                    return (
                      <span
                        key={day.ymd}
                        className="block"
                        style={{ width: cell, height: cell }}
                        aria-hidden="true"
                      />
                    );
                  }

                  const selected = interactive && day.ymd === selectedYmd;
                  const tone = cn(
                    radius,
                    heatClass(day.level),
                    day.inWindow ? "opacity-100" : "opacity-[0.32]",
                    selected
                      ? "ring-tui-accent ring-offset-tui-pane ring-[1.5px] ring-offset-[1.5px]"
                      : day.isToday && "ring-tui-ink/50 ring-1 ring-inset",
                  );

                  if (!interactive) {
                    return (
                      <span
                        key={day.ymd}
                        className={cn("block", tone)}
                        style={{ width: cell, height: cell }}
                        title={labels.dayCount(formatDay(day.date), day.count)}
                      />
                    );
                  }

                  const label = labels.dayCount(formatDay(day.date), day.count);
                  return (
                    <button
                      key={day.ymd}
                      type="button"
                      onClick={() => onSelect(day.ymd)}
                      onMouseEnter={() => setHovered(day.ymd)}
                      onFocus={() => setHovered(day.ymd)}
                      title={label}
                      aria-label={label}
                      aria-pressed={selected}
                      className={cn(
                        tone,
                        "transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        "hover:scale-[1.3] focus-visible:scale-[1.3] focus-visible:outline-none",
                      )}
                      style={{ width: cell, height: cell }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {interactive && (
        <span className="text-tui-ink3 text-[12px] tabular-nums">{caption}</span>
      )}
    </div>
  );
}

/** Less ▢▢▢▢ More — lives in the section head, apart from the grid itself. */
export function HeatLegend({ less, more }: { less: string; more: string }) {
  return (
    <span className="text-tui-ink3 flex items-center gap-[5px] text-[11px]">
      {less}
      {HEAT_LEGEND.map((level) => (
        <span key={level} className={cn("h-2.5 w-2.5 rounded-[2px]", heatClass(level))} />
      ))}
      {more}
    </span>
  );
}
