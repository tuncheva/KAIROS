"use client";

import { createPortal } from "react-dom";

/**
 * Renders a full-viewport overlay into `document.body`.
 *
 * Portalling is not a style preference here, it is required. The app shell wears
 * `.kairos-page-enter`, whose animation runs `forwards` and whose final keyframe
 * is `transform: translateY(0); filter: blur(0px)` — neither of which is `none`.
 * A computed transform or filter makes an element a containing block for
 * fixed-position descendants, so an overlay rendered inside the shell resolves
 * `position: fixed; inset: 0` against the shell's box rather than the viewport:
 * it starts inset past the navigation rail, sits offset vertically, and its
 * slide-in cannot be composited because it is inside a filtered ancestor.
 *
 * Mounting on `document.body` puts the overlay outside that containing block,
 * which is the only way to get true viewport coordinates back.
 *
 * Callers render this conditionally, so nothing reaches `document` during SSR.
 */
export function Overlay({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
