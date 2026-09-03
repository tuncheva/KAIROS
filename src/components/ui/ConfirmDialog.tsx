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
 *
 * The chrome is the surface every dialog now shares — a hairline card on a
 * blurred scrim, with the actions in a tinted footer rather than floating after
 * the last paragraph at whatever distance that paragraph happened to end. It
 * moved here rather than into the notes copy of this dialog so that there is
 * still exactly one of these; the surfaces that reach it — notes, settings,
 * projects, chat — all get the same treatment.
 *
 * It also, at last, has an exit. Dismissal is held for `MODAL_EXIT_MS` so the
 * card leaves; confirming is *not* held, because the action behind it should
 * start the moment it is pressed.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "./Modal";
import { modalExitMs } from "./modalExit";

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

  /* Held for the length of the exit so the card leaves rather than vanishing.
     Guarded, because a scrim click, an Escape and a Cancel press can all land
     inside one exit and the second would restart the timer. */
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  const dismiss = useCallback(() => {
    setClosing((already) => {
      if (already) return already;
      timer.current = setTimeout(() => cancelRef.current(), modalExitMs());
      return true;
    });
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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
      onDismiss={dismiss}
      overlayClassName={`bg-black/40 backdrop-blur-sm ${closing ? "notes-scrim--out" : "notes-scrim"}`}
      className={`w-full max-w-[380px] overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl ${
        closing ? "notes-dialog--out" : "notes-dialog"
      }`}
    >
      <>
        <div className="px-4 pt-4">
          <h2
            id="kairos-confirm-title"
            className="text-[15.5px] font-bold tracking-[-0.014em] text-fg-primary"
          >
            {title}
          </h2>
          <p
            id="kairos-confirm-message"
            className="mt-1.5 text-[13px] leading-relaxed text-fg-secondary"
          >
            {message}
          </p>

          {requireText !== undefined ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block font-mono text-[9.5px] tracking-[0.13em] uppercase text-fg-quaternary">
                {requireTextLabel}
              </span>
              <span className="flex h-[38px] items-center rounded-[10px] border border-border-medium bg-bg-surface px-3 transition-colors focus-within:border-accent-primary/60 focus-within:bg-bg-elevated focus-within:ring-[3px] focus-within:ring-accent-primary/10">
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
                  className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-fg-primary outline-none placeholder:text-fg-quaternary"
                />
              </span>
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="calendar-pop mt-3 text-[12.5px] text-error">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-border-light/50 bg-bg-surface px-4 py-3">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-8 items-center justify-center rounded-[10px] border border-border-medium px-3.5 text-[13px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(typed)}
            disabled={isPending || !textOk}
            className={`inline-flex h-8 items-center justify-center rounded-[10px] px-3.5 text-[13px] font-bold text-white transition-all duration-[350ms] hover:-translate-y-[1.5px] active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 ${
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
