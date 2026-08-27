"use client";

/**
 * A modal confirmation.
 *
 * Focus is trapped and returned on close, and Escape cancels — a dialog that
 * leaves focus behind it strands keyboard and screen-reader users on content
 * they cannot see.
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  isPending,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("chat.direct");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      /* Wrap at both ends, so Tab can never walk out of the dialog into the
         page behind it. */
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo.current?.focus();
    };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 grid place-items-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-sm p-6 rounded-2xl bg-bg-elevated kairos-system-card-elevated"
      >
        <h2 id="confirm-title" className="text-lg font-bold text-fg-primary mb-2">
          {title}
        </h2>
        <p id="confirm-message" className="text-sm text-fg-secondary mb-6">
          {message}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-fg-secondary hover:bg-bg-secondary transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              destructive ? "bg-error hover:brightness-110" : "bg-accent-primary hover:bg-accent-hover"
            }`}
          >
            {isPending ? t("working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
