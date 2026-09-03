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

import { useTranslations } from "next-intl";

import { Search } from "~/components/ui/icons";

export function SearchTrigger() {
  const t = useTranslations("ai.palette");

  const open = () => window.dispatchEvent(new CustomEvent("kairos:openPalette"));

  return (
    <button
      type="button"
      onClick={open}
      /* Focus opens it too, so tabbing to the field behaves the way the field
         looks like it behaves rather than leaving the user typing into a
         button. */
      onFocus={open}
      className="group flex h-8 min-w-0 items-center gap-2 rounded-[9px] border border-border-light/70 bg-bg-secondary/50 px-2.5 text-left text-fg-quaternary transition-colors hover:border-border-medium hover:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:outline-none sm:w-56 lg:w-72"
    >
      <Search size={14} className="shrink-0" aria-hidden="true" />
      <span className="hidden min-w-0 flex-1 truncate text-[13px] sm:block">
        {t("triggerLabel")}
      </span>
      <span className="sr-only sm:hidden">{t("triggerLabel")}</span>
    </button>
  );
}
