"use client";

/**
 * The feed's pagination.
 *
 * The feed used to grow forever behind an IntersectionObserver, so a hundred
 * events meant a hundred mounted cards, each with its own entrance animation
 * firing as it crossed into view — the reason scrolling a long feed looked the
 * way it did. Pages keep the DOM the size of one screenful and make "where was
 * I" answerable, which infinite scroll never did.
 *
 * The total is open-ended: the server hands out cursors, not a count, so the
 * pager shows the pages it can prove exist and a `+` while more are loadable.
 */

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

/** Page numbers around `page`, with `null` standing in for an elision. */
export function pageWindow(
  page: number,
  pageCount: number,
  span = 1,
): (number | null)[] {
  const wanted = new Set<number>([1, pageCount, page]);
  for (let offset = 1; offset <= span; offset++) {
    if (page - offset >= 1) wanted.add(page - offset);
    if (page + offset <= pageCount) wanted.add(page + offset);
  }

  const sorted = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const number of sorted) {
    /* An ellipsis standing in for one page is wider than the page it hides. */
    if (previous && number - previous === 2) out.push(previous + 1);
    else if (previous && number - previous > 2) out.push(null);
    out.push(number);
    previous = number;
  }
  return out;
}

export function FeedPager({
  page,
  pageCount,
  hasMore,
  isLoadingMore,
  onChange,
}: {
  page: number;
  pageCount: number;
  /** More pages are fetchable from the server beyond `pageCount`. */
  hasMore: boolean;
  isLoadingMore: boolean;
  onChange: (page: number) => void;
}) {
  const t = useTranslations("publish");

  if (pageCount <= 1 && !hasMore) return null;

  const step = "grid h-9 min-w-9 place-items-center rounded-lg border border-slate-200 px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10";

  return (
    <nav
      aria-label={t("pagination")}
      className="flex flex-wrap items-center justify-center gap-1.5 pt-2"
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label={t("previousPage")}
        className={`${step} text-fg-secondary hover:enabled:border-accent-primary/40 hover:enabled:text-accent-primary`}
      >
        <ChevronLeft size={15} />
      </button>

      {pageWindow(page, pageCount).map((entry, index) =>
        entry === null ? (
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="px-1 text-[13px] text-fg-quaternary"
          >
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            onClick={() => onChange(entry)}
            aria-current={entry === page ? "page" : undefined}
            className={`${step} kairos-mono ${
              entry === page
                ? "border-accent-primary/40 bg-accent-primary/10 font-semibold text-accent-primary"
                : "text-fg-secondary hover:border-accent-primary/40 hover:text-accent-primary"
            }`}
          >
            {entry}
          </button>
        ),
      )}

      {hasMore && (
        <span
          aria-hidden="true"
          className="kairos-mono px-1 text-[13px] text-fg-quaternary"
        >
          +
        </span>
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount && !hasMore}
        aria-label={t("nextPage")}
        className={`${step} text-fg-secondary hover:enabled:border-accent-primary/40 hover:enabled:text-accent-primary`}
      >
        {isLoadingMore && page >= pageCount ? (
          <Loader2 size={15} className="animate-spin text-accent-primary" />
        ) : (
          <ChevronRight size={15} />
        )}
      </button>
    </nav>
  );
}
