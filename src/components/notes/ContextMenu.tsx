"use client";

/**
 * A menu anchored to a point rather than to a trigger.
 *
 * `Menu` hangs off a button it can measure; a right-click has no button, only
 * coordinates — and coordinates near the right or bottom edge would put the
 * panel off screen, so it is measured after mount and flipped back inside.
 *
 * The keyboard behaviour is the same contract `Menu` keeps: Escape closes,
 * arrows walk the items, focus lands on the first item on open and returns to
 * whatever had it before. The browser fires `contextmenu` for the context-menu
 * key and Shift+F10 too, so the same handler covers the keyboard opening.
 *
 * The clamp is unchanged and deliberately so — it is the part of this file that
 * was already right. What is added is the exit, and an origin: the panel grows
 * from whichever corner the clamp left nearest the cursor, so a menu that had
 * to open upwards visibly opens upwards.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { exitMs, MENU_EXIT_MS, popoverOrigin } from "./notesMotion";
import { POPOVER_SURFACE } from "./notesUi";

export interface ContextMenuAnchor {
  x: number;
  y: number;
}

const MARGIN = 8;
const ESTIMATED = { width: 200, height: 280 };

export function ContextMenu({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: ContextMenuAnchor;
  label: string;
  onClose: () => void;
  /** Rendered open only. `close` lets an item dismiss the menu after acting. */
  children: (close: () => void) => React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<ContextMenuAnchor>(() => clamp(anchor, ESTIMATED));
  const [closing, setClosing] = useState(false);

  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  /* The parent owns the mount (`{contextMenu && <NoteContextMenu/>}`), so the
     exit is bought by delaying its `onClose` rather than by any state here. */
  const begin = useCallback((refocus: boolean) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    /* Now, not after the exit: an item's handler runs immediately after
       `close()` and may open a dialog that wants focus. See `Menu`. */
    if (refocus) restoreRef.current?.focus();
    timer.current = setTimeout(() => closeRef.current(), exitMs(MENU_EXIT_MS));
  }, []);

  /* Back to the row that was right-clicked, so the list is still walkable from
     the keyboard once the menu is gone. */
  const close = useCallback(() => begin(true), [begin]);
  const dismiss = useCallback(() => begin(false), [begin]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /* Captured before the menu takes focus. */
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
  }, []);

  /* Real size beats the estimate: measure, then place. `useLayoutEffect` so the
     correction happens before the browser paints the first position. */
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!box) return;
    setPosition(clamp(anchor, { width: box.width, height: box.height }));
  }, [anchor]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    if (closing) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    /* A second right-click elsewhere should move the menu, not stack one on
       top of the other — closing on `contextmenu` lets the new one open clean. */
    const onContextMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
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
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    /* Scrolling the list would leave the panel pointing at a different row. */
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [closing, close, dismiss]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{
        top: position.y,
        left: position.x,
        /* Whichever way the clamp pushed the panel is the way it came from. */
        transformOrigin: popoverOrigin({
          align: position.x < anchor.x ? "right" : "left",
          flipped: position.y < anchor.y,
        }),
      }}
      className={`fixed z-50 max-h-[70dvh] min-w-[190px] overflow-y-auto p-1.5 ${POPOVER_SURFACE} ${
        closing ? "notes-menu--out" : "notes-menu"
      }`}
    >
      {children(close)}
    </div>
  );
}

function clamp(anchor: ContextMenuAnchor, size: { width: number; height: number }): ContextMenuAnchor {
  if (typeof window === "undefined") return anchor;
  return {
    x: Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - size.width - MARGIN)),
    y: Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - size.height - MARGIN)),
  };
}
