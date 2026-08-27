"use client";

/**
 * A modal confirmation.
 *
 * Every destructive action on this surface routes through here — including
 * deleting a notebook, which used to ask with `window.confirm` while deleting a
 * note asked with a styled dialog. One surface should not speak two languages
 * about the same question.
 *
 * Focus is trapped and returned on close, and Escape cancels.
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  isPending,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  /** Defaults to "Cancel"; the reset prompt says "Try again" instead. */
  cancelLabel?: string;
  destructive?: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("notes");
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
      className="fixed inset-0 z-[70] bg-black/50 grid place-items-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="notes-confirm-title"
        aria-describedby="notes-confirm-message"
        className="w-full max-w-sm p-6 rounded-2xl bg-bg-elevated kairos-system-card-elevated"
      >
        <h2 id="notes-confirm-title" className="text-lg font-bold text-fg-primary mb-2">
          {title}
        </h2>
        <p id="notes-confirm-message" className="text-sm text-fg-secondary mb-6">
          {message}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-fg-secondary hover:bg-bg-secondary transition-colors"
          >
            {cancelLabel ?? t("common.cancel")}
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
            {isPending ? t("common.working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
