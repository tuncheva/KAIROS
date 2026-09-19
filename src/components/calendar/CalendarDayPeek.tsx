"use client";

import { useId, useRef } from "react";
import { ModalDismiss } from "~/components/ui/Modal";
import { Plus } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import { CalendarItemChip } from "./CalendarItemChip";
import { useDismissOnOutside, useFocusTrap } from "./useCalendarA11y";
import { itemUid, type CalendarItem } from "./calendarModel";

type Props = {
  items: CalendarItem[];
  title: string;
  countLabel: string;
  emptyLabel: string;
  addLabel: string;
  openDayLabel: string;
  closeLabel: string;
  describeItem: (item: CalendarItem) => string;
  onClose: () => void;
  onSelectItem: (item: CalendarItem) => void;
  onCreate: () => void;
  onOpenDayView: () => void;
};

/**
 * Everything on one day, as a dialog.
 *
 * This exists because a month cell can only show a few items, and the count of
 * the rest — "+3 more" — was a plain `<span>`. Those items were visible as a
 * number and reachable by nothing: not a click, not the keyboard, not the
 * detail panel. How many items a cell can fit is now a layout detail rather
 * than a limit on what you can open.
 *
 * It is also the day surface on touch, where a tap on a crowded cell has no
 * way to say which item it meant.
 */
export function CalendarDayPeek({
  items,
  title,
  countLabel,
  emptyLabel,
  addLabel,
  openDayLabel,
  closeLabel,
  describeItem,
  onClose,
  onSelectItem,
  onCreate,
  onOpenDayView,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useFocusTrap(panelRef, true, onClose);
  useDismissOnOutside(panelRef, true, onClose);

  return (
    /* Centred rather than anchored to its cell. An anchored popover has to
       flip and shift near the grid's edges, and the last column plus the last
       week is a quarter of the month — this is the same surface everywhere,
       and it is what a phone wants regardless. */
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] calendar-scrim" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="calendar-pop relative flex max-h-[min(28rem,80dvh)] w-full max-w-[22rem] flex-col overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl"
      >
        <div className="flex shrink-0 items-baseline gap-3 border-b border-border-light px-4 py-3">
          <h2 id={headingId} className="text-[15px] font-semibold tracking-tight text-fg-primary">
            {title}
          </h2>
          <span className="text-[11px] tabular-nums text-fg-tertiary">{countLabel}</span>
          <span className="flex-1" />
          <ModalDismiss onDismiss={onClose} label={closeLabel} />
        </div>

        <div className={cn("kairos-scroll-area flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3")}>
          {items.length === 0 ? (
            <p className="px-1 py-6 text-center text-[13px] text-fg-tertiary">{emptyLabel}</p>
          ) : (
            items.map((item) => (
              <CalendarItemChip
                key={itemUid(item)}
                item={item}
                label={describeItem(item)}
                className="px-2 py-1.5"
                onSelect={() => onSelectItem(item)}
              />
            ))
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border-light bg-bg-surface px-3 py-2.5">
          <button
            type="button"
            data-autofocus
            onClick={onCreate}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <Plus size={13} />
            {addLabel}
          </button>
          <button
            type="button"
            onClick={onOpenDayView}
            className="flex h-8 items-center rounded-lg border border-border-medium px-3 text-xs font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            {openDayLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
