"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * The last boundary. Reached only when an error escapes every nested one — a
 * root layout failure, or a page outside `(app)`.
 *
 * Translated like everything else. These four strings were the app's only
 * hardcoded English left in a shipped surface, and they were on the page shown
 * precisely when something has gone wrong: the worst possible moment to also
 * switch language on someone.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors.root");

  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg-primary px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 flex items-center justify-center">
          <span className="text-3xl">⚠</span>
        </div>
        <h1 className="text-2xl font-bold text-fg-primary">{t("title")}</h1>
        <p className="text-fg-secondary text-sm">
          {t("body")}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-accent-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            {t("retry")}
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 border border-slate-200 dark:border-white/10 text-fg-secondary text-sm font-medium rounded-lg hover:bg-bg-secondary transition-colors"
          >
            {t("home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
