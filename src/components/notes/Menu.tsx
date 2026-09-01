"use client";

/**
 * A small anchored menu.
 *
 * The old context menu was a `div` that appeared on click, closed via a
 * full-screen invisible overlay, and could not be reached or dismissed from the
 * keyboard at all. This is the same shape with the behaviour a menu owes you:
 * `role="menu"`, Escape to close, focus returned to the trigger, arrow keys
 * between items, and a click outside that does not need an overlay to notice.
 *
 * What it did not have was motion. `kairos-scale-in` has been in `globals.css`
 * since the design system landed and no notes menu ever used it, so all four
 * appeared and disappeared mid-frame. It grows out of the corner nearest its
 * trigger now — `transform-origin` set from `align`, because scaling about the
 * panel's own centre reads as arriving from nowhere — and shrinks back into it.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { exitMs, MENU_EXIT_MS, popoverOrigin } from "./notesMotion";
import { MICRO, POPOVER_SURFACE } from "./notesUi";

export function Menu({
  label,
  icon,
  align = "right",
  triggerClassName,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
  /** Rendered open only. `close` lets an item dismiss the menu after acting. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  /* A ref alongside the state: `close` can be called twice inside one exit — a
     pointer-outside and an Escape, or an item handler and the outside click it
     also triggered — and the second must not restart the timer. */
  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    setOpen(false);
    setClosing(false);
    closingRef.current = false;
  }, []);

  const begin = useCallback(
    (refocus: boolean) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      /* Synchronously, not after the exit. An item's handler runs immediately
         after `close()` and may open a dialog that wants focus; returning it to
         the trigger 120ms later would steal focus back out of that dialog.
         Doing it now also means `useModalBehavior` captures the trigger as the
         element to restore to, which is where it belongs. */
      if (refocus) triggerRef.current?.focus();
      timer.current = setTimeout(finish, exitMs(MENU_EXIT_MS));
    },
    [finish],
  );

  /** Dismiss and hand focus back — Escape, or an item that has acted. */
  const close = useCallback(() => begin(true), [begin]);
  /** Dismiss without taking focus — a click somewhere else on the page. */
  const dismiss = useCallback(() => begin(false), [begin]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open || closing) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) dismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
      if (!items || items.length === 0) return;
      event.preventDefault();

      const list = Array.from(items);
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? list[(index + 1) % list.length]
          : list[(index - 1 + list.length) % list.length];
      next?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closing, close, dismiss]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open && !closing}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={
          triggerClassName ??
          "kairos-tap grid h-7 w-7 place-items-center rounded-lg text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
        }
      >
        {icon}
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={{ transformOrigin: popoverOrigin({ align, flipped: false }) }}
          className={`absolute top-full z-30 mt-1.5 max-h-[290px] min-w-[186px] overflow-y-auto p-1.5 ${POPOVER_SURFACE} ${
            align === "right" ? "right-0" : "left-0"
          } ${closing ? "notes-menu--out" : "notes-menu"}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  onClick,
  destructive = false,
  disabled = false,
  children,
}: {
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-colors disabled:opacity-40 ${
        destructive
          ? "text-fg-secondary hover:bg-error/10 hover:text-error"
          : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
      }`}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 border-t border-border-light/55" />;
}

/**
 * A section label inside a menu.
 *
 * The same micro-label the list uses for "Today" and the rail uses for
 * "Notebooks" — so "Notebook" in a menu and a date bucket in the list are
 * visibly the same kind of thing, which they were not when this was
 * `text-[9.5px] font-semibold tracking-widest` and those were two other sizes.
 */
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className={`${MICRO} px-2.5 pt-2 pb-1`}>{children}</p>;
}
