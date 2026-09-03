/**
 * How long a notes overlay stays mounted after it has been asked to close.
 *
 * Every dialog and menu on this surface used to unmount the frame it was
 * dismissed — `{open && <Dialog/>}` and nothing else — so there was an entrance
 * to animate and never an exit. Holding the element for the length of its
 * `--out` rule is what turns "gone" into "left".
 *
 * The numbers are the CSS, restated: `.notes-dialog--out` is 0.15s,
 * `.notes-menu--out` is 0.12s, `.notes-sheet--out` is 0.45s. They live here so
 * the hold and the keyframes cannot drift apart one component at a time — the
 * same reason `ui/drawerExit.ts` exists, and the sheet deliberately reuses that
 * file's constant because it plays that file's animation.
 */

import { DRAWER_EXIT_MS } from "~/components/ui/drawerExit";
import { MODAL_EXIT_MS } from "~/components/ui/modalExit";

/**
 * Matches `.notes-dialog--out`.
 *
 * Taken from the shared modal constant rather than written out again: notes
 * dialogs and `ui/ConfirmDialog` play the same pair of keyframes, so retuning
 * one retunes both.
 */
export const DIALOG_EXIT_MS = MODAL_EXIT_MS;

/** Matches `.notes-menu--out`. */
export const MENU_EXIT_MS = 120;

/**
 * Matches `.notes-push-in`.
 *
 * Not an exit — this is how long the class stays on the pane that just arrived
 * on mobile. It has to be removed again, because the alternative (leaving it on,
 * or keying the wrapper so it remounts) makes the pane rebuild itself on every
 * selection, which on desktop reads as the editor reloading.
 */
export const PANE_SWAP_MS = 320;

/**
 * Matches `.notes-sheet--out`, which *is* `projects-drawer-out`.
 *
 * Taken from the drawer constant rather than written out again: the rail sheet
 * plays the same keyframes as every other drawer in the app, so if that timing
 * is ever retuned this follows it.
 */
export const SHEET_EXIT_MS = DRAWER_EXIT_MS;

/**
 * The hold to use right now.
 *
 * Reduced-motion users skip it: their `--out` rules resolve to
 * `animation: none` with an opacity of 0, so there is nothing left to wait for
 * and waiting would only delay the unmount.
 *
 * A timer rather than an `animationend` listener, for the reason
 * `drawerExit.ts` gives — with `animation: none` no such event ever fires, and
 * a listener-based unmount would strand the overlay on screen forever.
 */
export function exitMs(full: number): number {
  if (typeof window === "undefined" || !window.matchMedia) return full;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : full;
}

/**
 * Where a popup should grow from.
 *
 * `kairos-scale-in` scales about the element's own centre, which for a menu
 * hanging under a button reads as the panel arriving from nowhere. Given the
 * trigger's box and the panel's own, this returns the corner nearest the
 * trigger, so the menu appears to come out of the thing that opened it.
 *
 * Returns a `transform-origin` value, to be set inline — the corner is only
 * known at open time and differs per trigger.
 */
export function popoverOrigin({
  align,
  flipped,
}: {
  align: "left" | "right";
  /** True when the panel had to open upwards to stay on screen. */
  flipped: boolean;
}): string {
  return `${flipped ? "bottom" : "top"} ${align}`;
}
