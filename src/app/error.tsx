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
 * The last boundary. Reached only when an error escapes every nested one — a
 * root layout failure, or a page outside `(app)`.
 *
 * Wears the brand vocabulary rather than a bold sans heading and a warning
 * character in whatever emoji font the OS supplies: a mono eyebrow, the Kairos
 * mark, a display-serif headline, and the digest on a mono line that copies
 * itself. The icon comes from `ui/icons`, so it is drawn rather than typed.
 *
 * Translated like everything else. These strings are on the page shown
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
  const tErrors = useTranslations("errors");

  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
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
          <Link href="/" className={SYSTEM_ACTION_QUIET}>
            {t("home")}
          </Link>
        </>
      }
      footer={
        error.digest ? (
          <ErrorDigest
            digest={error.digest}
            copyLabel={tErrors("digestCopy", { digest: shortDigest(error.digest) })}
            copiedLabel={tErrors("digestCopied", { digest: shortDigest(error.digest) })}
          />
        ) : null
      }
    />
  );
}

/** Enough of the digest to match a log line, short enough to read aloud. */
function shortDigest(digest: string): string {
  return digest.slice(0, 8);
}
