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
 * The focus trap, Escape, `activeElement` restore, body-scroll lock and portal
 * all come from `./Modal`, which is where that behaviour lives for every
 * dialog in the app.
 */

import { useEffect, useRef, useState } from "react";

import { Modal } from "./Modal";

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

  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* The caret belongs in the gate when there is one: focusing a button that
     cannot yet be pressed leaves the user hunting for what is missing. Runs
     after `useModalBehavior` has focused the first element, and overrides it. */
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
    else confirmRef.current?.focus();
  }, []);

  return (
    <Modal
      role="alertdialog"
      labelledBy="kairos-confirm-title"
      describedBy="kairos-confirm-message"
      onDismiss={onCancel}
      className="w-full max-w-sm p-6 rounded-2xl bg-bg-elevated kairos-menu-surface"
    >
      <>
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
      </>
    </Modal>
  );
}
