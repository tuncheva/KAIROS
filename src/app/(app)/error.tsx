"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { AlertCircle } from "~/components/ui/icons";
import { ErrorDigest } from "~/components/ui/ErrorDigest";
import {
  SYSTEM_ACTION_PRIMARY,
  SYSTEM_ACTION_QUIET,
  SystemScreen,
} from "~/components/ui/SystemScreen";

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
 *
 * Same vocabulary as the root boundary — one screen drawn twice, not two
 * designs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors.app");
  const tErrors = useTranslations("errors");

  useEffect(() => {
    console.error("[app] unhandled error:", error);
  }, [error]);

  return (
    <main id="main-content" className="rail-offset">
      <SystemScreen
        eyebrow={t("eyebrow")}
        title={t("title")}
        body={t("body")}
        icon={<AlertCircle size={20} />}
        actions={
          <>
            <button type="button" onClick={reset} className={SYSTEM_ACTION_PRIMARY}>
              {t("retry")}
            </button>
            <Link href="/dashboard" className={SYSTEM_ACTION_QUIET}>
              {t("dashboard")}
            </Link>
          </>
        }
        footer={
          error.digest ? (
            <ErrorDigest
              digest={error.digest}
              copyLabel={tErrors("digestCopy", { digest: error.digest.slice(0, 8) })}
              copiedLabel={tErrors("digestCopied", { digest: error.digest.slice(0, 8) })}
            />
          ) : null
        }
      />
    </main>
  );
}
