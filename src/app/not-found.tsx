"use client";

/* A client component so it renders inside the root layout's intl provider
   without the page itself becoming async — `not-found.tsx` is rendered in
   places where an async boundary is awkward, and the copy is four strings. */

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("errors.notFound");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg-primary kairos-page-enter">
      <div className="text-center space-y-6 max-w-md px-6">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-primary/10 flex items-center justify-center">
          <span className="text-4xl font-bold text-accent-primary">404</span>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-fg-primary mb-2">{t("title")}</h2>
          <p className="text-fg-secondary">
            {t("body")}
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent-primary text-white font-medium rounded-xl hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] kairos-btn"
        >
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
