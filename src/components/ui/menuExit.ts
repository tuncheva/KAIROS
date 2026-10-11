"use client";

/**
 * How long a top-bar dropdown stays mounted after it has been asked to close.
 *
 * The profile and workspace menus rendered `{open && <menu/>}`, so they snapped
 * in and vanished on the frame they were dismissed. This is the `modalExit.ts`
 * arrangement for dropdowns: keep the panel for the length of its `--out` rule,
 * swap the enter class for the exit one, then unmount.
 *
 * Must match `.topbar-menu--out` in `globals.css`.
 */

import { useEffect, useState } from "react";

export const TOPBAR_MENU_EXIT_MS = 120;

/**
 * The hold to use right now. Reduced-motion users skip it — their `--out` rule
 * is `animation: none`, so there is nothing to wait for. A timer rather than
 * `animationend`, because with `animation: none` that event never fires.
 */
function menuExitMs(): number {
  if (typeof window === "undefined" || !window.matchMedia) return TOPBAR_MENU_EXIT_MS;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : TOPBAR_MENU_EXIT_MS;
}

/**
 * Turns a plain `open` flag into enter/exit presence.
 *
 * `mounted` is what to render on; `closing` is true for the exit hold, while
 * the panel is still on screen but already on its way out — render the `--out`
 * class and stop it taking clicks. Callers keep their own `setOpen(false)`
 * everywhere; nothing about how a menu closes has to change.
 */
export function useMenuExit(open: boolean): { mounted: boolean; closing: boolean } {
  const [held, setHeld] = useState(open);

  useEffect(() => {
    if (open) {
      setHeld(true);
      return;
    }
    const timer = setTimeout(() => setHeld(false), menuExitMs());
    return () => clearTimeout(timer);
  }, [open]);

  return { mounted: open || held, closing: !open && held };
}
