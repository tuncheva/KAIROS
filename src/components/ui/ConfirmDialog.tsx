"use client";

/**
 * The one way to ask "are you sure".
 *
 * The app used to have five: a native `window.confirm` in settings, two
 * near-identical styled dialogs in notes and chat, a two-click "arm" button
 * that silently disarmed after four seconds, and a bespoke overlay in
 * projects. The three highest-stakes actions in the product — leaving an
 * organisation, removing a member, deleting a role — used the unstyled,
 * unthemed, untranslatable browser box.
 *
 * This is the settings implementation promoted, because it was the superset:
 * it stays open on failure so the server's reason ("you are the only admin")
 * lands somewhere the user is already looking, and it can demand the name
 * typed back for the handful of actions that destroy other people's work.
 *
 * Focus is trapped and returned on close, and Escape cancels.
 *
 * Rendered through a portal onto `document.body`: callers live inside
 * ancestors that carry transforms and filters, and a `position: fixed` overlay
 * inside one of those is contained by it rather than by the viewport — the
 * backdrop covers only part of the page and the card lands wherever the row is.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  error,
  requireText,
  requireTextLabel,
  destructive = false,
  isPending,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Shown in place of nothing when the confirmed action came back rejected. */
  error?: string | null;
  /**
   * When set, confirming is refused until the user has typed this string back.
   *
   * For the handful of actions that destroy other people's work, a button that
   * can be hit by muscle memory is not enough of a gate. Reproducing the name
   * forces the user to read which thing they are about to delete.
   */
  requireText?: string;
  /** Field label for the typed confirmation. Required when `requireText` is. */
  requireTextLabel?: string;
  destructive?: boolean;
  isPending: boolean;
  onCancel: () => void;
  /** Receives what the user typed, when `requireText` asked for something. */
  onConfirm: (typedText: string) => void;
}) {
  const [typed, setTyped] = useState("");
  /* Trimmed on both sides only — the comparison stays case-sensitive, since
     the point is that the user reproduced the name rather than recognised it.
     The server checks this again; see `organization.delete`. */
  const textOk = requireText === undefined || typed.trim() === requireText;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  // Portals need a DOM to aim at, which the server render does not have.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    /* With a gate to pass, the caret belongs in it: focusing a button that
       cannot yet be pressed leaves the user hunting for what is missing. */
    if (inputRef.current) inputRef.current.focus();
    else confirmRef.current?.focus();

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

  /* Body-scroll lock. No overlay in the app had one, which on iOS lets the
     page behind the dialog scroll under your finger while the question is
     still on screen. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto overscroll-contain bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kairos-confirm-title"
        aria-describedby="kairos-confirm-message"
        className="w-full max-w-sm p-6 rounded-2xl bg-bg-elevated kairos-menu-surface"
      >
        <h2 id="kairos-confirm-title" className="text-lg font-bold text-fg-primary mb-2">
          {title}
        </h2>
        <p id="kairos-confirm-message" className="text-sm text-fg-secondary mb-6">
          {message}
        </p>
        {requireText !== undefined ? (
          <label className="mb-6 -mt-2 block">
            <span className="mb-1.5 block text-xs font-medium text-fg-secondary">
              {requireTextLabel}
            </span>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && textOk && !isPending) onConfirm(typed);
              }}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label={requireTextLabel}
              className="w-full rounded-lg border border-border-medium bg-bg-secondary px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent-primary"
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="-mt-4 mb-6 text-sm text-error">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-fg-secondary hover:bg-bg-secondary transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(typed)}
            disabled={isPending || !textOk}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              destructive ? "bg-error hover:brightness-110" : "bg-accent-primary hover:bg-accent-hover"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
