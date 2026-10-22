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
import { usePathname } from "next/navigation";

import { Search, Sparkles } from "~/components/ui/icons";

export function SearchTrigger() {
  const t = useTranslations("ai.palette");
  const pathname = usePathname();
  // "Ctrl" until mounted, so the server and first client render agree — the
  // same dance as the rail's shortcut hints in `SideNav`.
  const [modKey, setModKey] = useState("Ctrl");

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setModKey("⌘");
  }, []);

  const open = () => window.dispatchEvent(new CustomEvent("kairos:openPalette"));
  const askAboutPage = () =>
    window.dispatchEvent(new CustomEvent("kairos:askAboutPage"));

  /* The widget is not mounted on the chat pages — the page is the chat — so a
     button that opens it would do nothing there. */
  const showAsk = !pathname.startsWith("/chat");

  return (
    /* A pill rather than a field, and it says ⌘K out loud: the shortcut is the
       fast way in, and the bar was the only place that could teach it. Below
       `sm` it folds to a round door — a phone has no keyboard to hint at.

       Two doors in one pill. The AI chip used to be a label inside the palette
       button, so clicking it opened the palette — where typing "notes" and
       pressing Enter navigates to Notes, which is not what anyone pressing "AI"
       meant. It is its own button now and asks about the page you are on. The
       palette button is stretched underneath everything else, so the rest of
       the pill — label, shortcut hint — still opens the palette as before. */
    <div className="group relative flex h-9 w-9 min-w-0 shrink-0 items-center justify-center gap-2 rounded-full border border-tui-ink/10 text-tui-ink3 transition-colors hover:border-tui-ink/16 hover:text-tui-ink2 sm:w-64 sm:shrink sm:justify-start sm:border-tui-ink/8 sm:bg-tui-ink/[0.035] sm:pr-1.5 sm:pl-3.5 sm:hover:bg-tui-pane lg:w-[340px]">
      <button
        type="button"
        onClick={open}
        /* Focus opens it too, so tabbing to the field behaves the way the field
           looks like it behaves rather than leaving the user typing into a
           button. */
        onFocus={open}
        aria-keyshortcuts="Control+K Meta+K"
        aria-label={t("triggerLabel")}
        className="absolute inset-0 cursor-text rounded-full focus-visible:ring-2 focus-visible:ring-tui-accent focus-visible:outline-none"
      />
      <Search size={15} className="pointer-events-none shrink-0" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="pointer-events-none hidden min-w-0 flex-1 truncate text-[13px] sm:block"
      >
        {t("triggerLabel")}
      </span>
      {showAsk && (
        <button
          type="button"
          onClick={askAboutPage}
          aria-label={t("askAboutPage")}
          title={t("askAboutPage")}
          className="relative z-10 hidden h-6 shrink-0 items-center gap-1 rounded-full bg-tui-accent/10 px-2 text-[11.5px] font-medium text-tui-accent transition-colors hover:bg-tui-accent/20 focus-visible:ring-2 focus-visible:ring-tui-accent focus-visible:outline-none lg:inline-flex"
        >
          <Sparkles size={12} aria-hidden="true" />
          AI
        </button>
      )}
      <kbd
        aria-hidden="true"
        className="pointer-events-none hidden h-[22px] shrink-0 items-center rounded-full border border-tui-ink/12 bg-tui-pane px-2 font-mono text-[11px] text-tui-ink3 sm:inline-flex"
      >
        {modKey === "⌘" ? "⌘K" : "Ctrl K"}
      </kbd>
    </div>
  );
}
