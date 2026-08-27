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
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

  const close = useCallback(() => {
    onClose();
    /* Back to the row that was right-clicked, so the list is still walkable
       from the keyboard once the menu is gone. */
    restoreRef.current?.focus();
  }, [onClose]);

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
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    /* A second right-click elsewhere should move the menu, not stack one on
       top of the other — closing on `contextmenu` lets the new one open clean. */
    const onContextMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
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
    window.addEventListener("resize", onClose);
    /* Scrolling the list would leave the panel pointing at a different row. */
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose, close]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ top: position.y, left: position.x }}
      className="fixed z-50 min-w-[190px] max-h-[70dvh] overflow-y-auto p-1.5 rounded-xl bg-bg-elevated kairos-menu-surface"
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
