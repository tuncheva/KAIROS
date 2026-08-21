"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

import { A1ChatWidgetOverlay } from "~/components/chat/A1ChatWidgetOverlay";
import { CommandPalette } from "~/components/layout/CommandPalette";

/**
 * The global AI surfaces, rendered once in the root layout.
 *
 * Two things, both signed-in only:
 *
 * - The floating chat widget, hidden on the full-page chat to avoid two of it.
 * - The ⌘K command palette (D-2), which is *not* hidden anywhere: the reason to
 *   have a palette at all is that it works from wherever you happen to be, and a
 *   shortcut that stops working on one page is a shortcut people stop reaching
 *   for everywhere.
 */
export function GlobalAIWidget() {
  const { data: session } = useSession();
  const pathname = usePathname();

  if (!session) return null;

  return (
    <>
      <CommandPalette />
      {pathname === "/chat/ai" ? null : <A1ChatWidgetOverlay />}
    </>
  );
}
