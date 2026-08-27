"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg-primary px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 flex items-center justify-center">
          <span className="text-3xl">⚠</span>
        </div>
        <h1 className="text-2xl font-bold text-fg-primary">Something went wrong</h1>
        <p className="text-fg-secondary text-sm">
          An unexpected error occurred. Please try again or go back to the home page.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-accent-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 border border-slate-200 dark:border-white/10 text-fg-secondary text-sm font-medium rounded-lg hover:bg-bg-secondary transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
