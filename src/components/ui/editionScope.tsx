"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Carries a page's edition across a portal.
 *
 * The refined screens get their palette from a wrapper class (`.settings-elegant`,
 * `.chat-refined`, `.calendar-refined`, `.notes-quiet`, and `.tui-refined` on the app
 * and auth layouts) that remaps the semantic
 * tokens for everything inside it. A dialog or drawer portalled to
 * `document.body` is no longer inside it, so it fell back to the classic cool
 * palette and the bright accent — a settings confirm, the calendar drawer and
 * the projects delete dialog all looked like a different app.
 *
 * `useEditionScope` reads the edition from where the caller sits in the tree,
 * through a hidden anchor rendered in place, and `EditionScope` puts the same
 * class back on a `display: contents` wrapper inside the portal. `contents`
 * means the wrapper has no box: the edition's own background and colour paint
 * nothing, and the custom properties still inherit down to the dialog.
 */

const EDITIONS = [
  "settings-elegant",
  "chat-refined",
  "calendar-refined",
  "notes-quiet",
  "tui-refined",
] as const;
const EDITION_SELECTOR = EDITIONS.map((c) => `.${c}`).join(", ");

export function useEditionScope() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [edition, setEdition] = useState("");

  /* Layout effect, so the class lands before the first paint of the portal and
     the dialog never flashes in the classic palette. */
  useLayoutEffect(() => {
    const host = anchorRef.current?.parentElement?.closest(EDITION_SELECTOR);
    setEdition(
      host ? EDITIONS.filter((c) => host.classList.contains(c)).join(" ") : "",
    );
  }, []);

  const anchor = <span ref={anchorRef} hidden />;
  return { anchor, edition };
}

/** Always the same element, with or without a class, so the dialog inside is
    never remounted (and never loses focus) when the edition arrives. */
export function EditionScope({
  edition,
  children,
}: {
  edition: string;
  children: ReactNode;
}) {
  return <div className={`contents ${edition}`}>{children}</div>;
}
