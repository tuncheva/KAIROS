/**
 * How long a centred dialog stays mounted after it has been asked to close.
 *
 * `Modal` had an entrance and no exit, so every dialog in the app disappeared
 * on the frame it was dismissed. This is the drawer arrangement from
 * `drawerExit.ts` applied to the other overlay shape: the caller (or the dialog
 * itself) holds a `closing` flag for this long, swaps the enter class for the
 * `--out` one, and unmounts when it has elapsed.
 *
 * Must match `.notes-dialog--out` in `globals.css`, which is where the keyframe
 * pairing lives.
 */
export const MODAL_EXIT_MS = 150;

/**
 * The hold to use right now.
 *
 * Reduced-motion users skip it: their `--out` rule resolves to
 * `animation: none` with `opacity: 0`, so there is nothing left to wait for and
 * waiting would only delay the unmount.
 *
 * A timer rather than an `animationend` listener, for the reason
 * `drawerExit.ts` gives — with `animation: none` no such event ever fires, and
 * a listener-based unmount would strand the dialog on screen forever.
 */
export function modalExitMs(): number {
  if (typeof window === "undefined" || !window.matchMedia) return MODAL_EXIT_MS;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : MODAL_EXIT_MS;
}
