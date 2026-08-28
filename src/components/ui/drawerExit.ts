/**
 * How long a right-hand drawer stays mounted after it has been asked to close.
 *
 * Must match `.projects-drawer-out` in `globals.css`, which mirrors the
 * entrance at 0.45s. This is the *panel's* duration, not the scrim's shorter
 * 0.35s: the panel is the last thing still moving, and unmounting on the scrim
 * would cut the slide off two thirds of the way through.
 *
 * Every drawer that plays that pair of animations shares this number, so the
 * hold and the keyframes cannot drift apart one component at a time.
 */
export const DRAWER_EXIT_MS = 450;

/**
 * The hold to use right now.
 *
 * Reduced-motion users skip it entirely — there is no motion to wait for, and
 * the exit rules resolve to `animation: none` for them.
 *
 * Callers use a timer rather than an `animationend` listener for the same
 * reason: with `animation: none` no such event ever fires, and a
 * listener-based unmount would strand the drawer on screen forever.
 */
export function exitDurationMs(): number {
  if (typeof window === "undefined" || !window.matchMedia) return DRAWER_EXIT_MS;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : DRAWER_EXIT_MS;
}
