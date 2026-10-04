"use client";

/**
 * The search field in the TopBar.
 *
 * The command palette is the best navigation in the app — local matching, an
 * explicit AI fallback, accent-insensitive — and nothing in the interface
 * mentioned it. It was reachable only by ⌘K, which you have to already know
 * about. Meanwhile the README promised "full-text search across the
 * workspace", so the two halves of the problem were: search had no home, and
 * the palette had no door.
 *
 * This is both. It is not an input that searches — it is the palette's door,
 * shaped like the thing people look for. Focusing or clicking it opens the
 * real palette, which owns the query, the keyboard model and the results.
 * Rendering a second search field that duplicated any of that would be a
 * second implementation to keep in step.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Search, Sparkles } from "~/components/ui/icons";

export function SearchTrigger() {
  const t = useTranslations("ai.palette");
  // "Ctrl" until mounted, so the server and first client render agree — the
  // same dance as the rail's shortcut hints in `SideNav`.
  const [modKey, setModKey] = useState("Ctrl");

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setModKey("⌘");
  }, []);

  const open = () => window.dispatchEvent(new CustomEvent("kairos:openPalette"));

  return (
    <button
      type="button"
      onClick={open}
      /* Focus opens it too, so tabbing to the field behaves the way the field
         looks like it behaves rather than leaving the user typing into a
         button. */
      onFocus={open}
      aria-keyshortcuts="Control+K Meta+K"
      /* A pill rather than a field, and it says ⌘K out loud: the shortcut is
         the fast way in, and the bar was the only place that could teach it.
         Below `sm` it folds to a round door — a phone has no keyboard to hint
         at. */
      className="group flex h-9 w-9 min-w-0 shrink-0 items-center justify-center gap-2 rounded-full border border-tui-ink/10 text-left text-tui-ink3 transition-colors hover:border-tui-ink/16 hover:text-tui-ink2 focus-visible:ring-2 focus-visible:ring-tui-accent focus-visible:outline-none sm:w-64 sm:shrink sm:justify-start sm:border-tui-ink/8 sm:bg-tui-ink/[0.035] sm:pr-1.5 sm:pl-3.5 sm:hover:bg-tui-pane lg:w-[340px]"
    >
      <Search size={15} className="shrink-0" aria-hidden="true" />
      <span className="hidden min-w-0 flex-1 truncate text-[13px] sm:block">
        {t("triggerLabel")}
      </span>
      <span className="sr-only sm:hidden">{t("triggerLabel")}</span>
      {/* The palette's AI fallback, hinted before you open it. */}
      <span
        aria-hidden="true"
        className="hidden h-6 shrink-0 items-center gap-1 rounded-full bg-tui-accent/10 px-2 text-[11.5px] font-medium text-tui-accent lg:inline-flex"
      >
        <Sparkles size={12} />
        AI
      </span>
      <kbd
        aria-hidden="true"
        className="hidden h-[22px] shrink-0 items-center rounded-full border border-tui-ink/12 bg-tui-pane px-2 font-mono text-[11px] text-tui-ink3 sm:inline-flex"
      >
        {modKey === "⌘" ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
