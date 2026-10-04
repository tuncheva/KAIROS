"use client";

/* A client component so it renders inside the root layout's intl provider
   without the page itself becoming async — `not-found.tsx` is rendered in
   places where an async boundary is awkward, and the copy is four strings. */

import Link from "next/link";
import { useTranslations } from "next-intl";

import { SYSTEM_ACTION_PRIMARY, SystemScreen } from "~/components/ui/SystemScreen";

/**
 * The 404.
 *
 * Same vocabulary as the error boundaries: the Kairos mark, a mono eyebrow
 * carrying the status, a display-serif headline and Geist body copy. The old
 * screen set "404" in bold sans at text-4xl inside a tinted tile, which is the
 * one place in the product where a number was doing a stamp's job.
 */
export default function NotFound() {
  const t = useTranslations("errors.notFound");

  return (
    <SystemScreen
      eyebrow={t("eyebrow")}
      title={t("title")}
      body={t("body")}
      actions={
        <Link href="/" className={`${SYSTEM_ACTION_PRIMARY} kairos-btn`}>
          {t("home")}
        </Link>
      }
    />
  );
}
