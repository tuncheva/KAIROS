"use client";

import { useState } from "react";
import { cn } from "~/lib/utils";
import { HEAT_LEGEND, fromYmd, heatClass, type GridWeek } from "./progressModel";

/** Cell edge and the gap between cells, in pixels — as in the redesign. */
const CELL = 14;
const GAP = 4;
/** Width of the weekday gutter, when it is shown. */
const GUTTER = 30;

type Props = {
  weeks: GridWeek[];
  selectedYmd: string | null;
  onSelect: (ymd: string | null) => void;
  /** Mon/Wed/Fri gutter — the wide layout has room for it, the profile does not. */
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
    daySelected: (day: string) => string;
  };
};

export function ProgressGrid({
  weeks,
  selectedYmd,
  onSelect,
  showWeekdays = false,
  weekdayLabels,
  formatMonth,
  formatDay,
  labels,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const gutter = showWeekdays && weekdayLabels ? GUTTER : 0;
  // Rows are Monday-first; only every other one is named, so the gutter
  // stays readable at a 14px row height.
  const rowNames = weekdayLabels
    ? [weekdayLabels.monday, "", weekdayLabels.wednesday, "", weekdayLabels.friday, "", ""]
    : [];

  const hoveredDay = hovered
    ? weeks.flatMap((w) => w.days).find((d) => d.ymd === hovered)
    : null;

  const caption = hoveredDay
    ? labels.dayCount(formatDay(hoveredDay.date), hoveredDay.count)
    : selectedYmd
      ? labels.daySelected(formatDay(fromYmd(selectedYmd) ?? new Date()))
      : labels.hint;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="overflow-x-auto"
        onMouseLeave={() => setHovered(null)}
      >
        <div className="flex w-max flex-col gap-2.5">
          {/* Month ticks. Each column is CELL wide plus its gap, so a label
              placed on a column lines up with the week it names. */}
          <div className="flex" style={{ gap: GAP, paddingLeft: gutter }}>
            {weeks.map((week) => (
              <span
                key={week.key}
                className="whitespace-nowrap text-[10px] tabular-nums text-fg-tertiary"
                style={{ width: CELL }}
              >
                {week.monthLabel ? formatMonth(week.monthLabel) : ""}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap: GAP }}>
            {gutter > 0 && (
              <div
                className="flex shrink-0 flex-col"
                style={{ width: gutter, gap: GAP }}
                aria-hidden="true"
              >
                {Array.from({ length: 7 }, (_, row) => (
                  <span
                    key={row}
                    className="flex items-center text-[9px] text-fg-quaternary"
                    style={{ height: CELL }}
                  >
                    {rowNames[row] ?? ""}
                  </span>
                ))}
              </div>
            )}

            {weeks.map((week) => (
              <div key={week.key} className="flex flex-col" style={{ gap: GAP }}>
                {week.days.map((day) => {
                  if (day.isFuture) {
                    return (
                      <span
                        key={day.ymd}
                        className="block"
                        style={{ width: CELL, height: CELL }}
                        aria-hidden="true"
                      />
                    );
                  }

                  const selected = day.ymd === selectedYmd;

                  return (
                    <button
                      key={day.ymd}
                      type="button"
                      onClick={() => onSelect(selected ? null : day.ymd)}
                      onMouseEnter={() => setHovered(day.ymd)}
                      onFocus={() => setHovered(day.ymd)}
                      title={labels.dayCount(formatDay(day.date), day.count)}
                      aria-label={labels.dayCount(formatDay(day.date), day.count)}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-[3px] border transition-transform duration-200",
                        "hover:scale-[1.35] focus-visible:scale-[1.35] focus-visible:outline-none",
                        heatClass(day.level),
                        selected
                          ? "border-accent-primary"
                          : day.isToday
                            ? "border-fg-primary/40"
                            : "border-transparent",
                        day.inWindow ? "opacity-100" : "opacity-[0.34]",
                      )}
                      style={{ width: CELL, height: CELL }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] tabular-nums text-fg-tertiary">{caption}</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] text-fg-quaternary">{labels.less}</span>
          {HEAT_LEGEND.map((level) => (
            <span
              key={level}
              className={cn("h-[11px] w-[11px] rounded-[3px]", heatClass(level))}
            />
          ))}
          <span className="text-[10px] text-fg-quaternary">{labels.more}</span>
        </span>
      </div>
    </div>
  );
}
