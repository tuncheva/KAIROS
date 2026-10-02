"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * "Still loading…" — the quiet mono line a skeleton panel grows after 8s.
 *
 * Always mounted with the skeleton; the 8s wait is the CSS animation delay on
 * `.k-skel-slow`, so it costs no timer and starts counting with the skeleton
 * itself. Retry refreshes the route (or runs `onRetry`, for a client query).
 * Never a spinner.
 */
export function SkeletonSlow({
  what = "generic",
  onRetry,
  className = "",
}: {
  what?:
    | "generic"
    | "projects"
    | "note"
    | "messages"
    | "people"
    | "progress"
    | "events"
    | "calendar"
    | "settings"
    | "answer";
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations("skeleton");
  const router = useRouter();

  return (
    <div
      className={`k-skel-slow mt-auto flex items-center gap-2.5 pt-3 font-mono text-[11.5px] text-tui-ink3 ${className}`}
    >
      <span className="min-w-0 flex-1">{t(`slow.${what}`)}</span>
      <button
        type="button"
        onClick={() => (onRetry ? onRetry() : router.refresh())}
        className="flex h-[26px] shrink-0 items-center rounded-full border border-tui-ink/16 px-[11px] font-sans text-[12px] text-tui-ink2 hover:border-tui-ink/30 hover:text-tui-ink"
      >
        {t("retry")}
      </button>
    </div>
  );
}
