"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * The signed-in app's error boundary.
 *
 * Without a boundary in this segment, any error thrown inside a page escaped to
 * the root `error.tsx`, which replaces the entire document — so a single failing
 * panel took the rail, the workspace switcher and every route with it, and the
 * only way back was the "Go home" link out to the marketing page.
 *
 * Because this file lives inside `(app)`, the layout above it survives: the rail
 * stays mounted and navigable, and the error is confined to the page that threw.
 * `.rail-offset` is what keeps this message clear of that still-present rail.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors.app");

  useEffect(() => {
    console.error("[app] unhandled error:", error);
  }, [error]);

  return (
    <div className="rail-offset min-h-dvh bg-bg-primary">
      <main id="main-content" className="flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-error/10 border border-error/20">
            <span aria-hidden="true" className="text-2xl">
              ⚠
            </span>
          </div>
          <h1 className="text-xl font-bold text-fg-primary">{t("title")}</h1>
          <p className="text-sm text-fg-secondary">{t("body")}</p>
          {/* The digest is the only handle support has on a server-side error;
              without it a report is "it broke on some page at some time". */}
          {error.digest ? (
            <p className="font-mono text-[11px] text-fg-quaternary">{error.digest}</p>
          ) : null}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-lg bg-accent-primary px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
            >
              {t("retry")}
            </button>
            <Link
              href="/dashboard"
              className="rounded-lg border border-border-light px-5 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
            >
              {t("dashboard")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
