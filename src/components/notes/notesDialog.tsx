"use client";

/**
 * One chrome for every dialog on this surface.
 *
 * There used to be five of these, and they disagreed with each other in every
 * way a dialog can. `LockNoteDialog`, `RemoveLockDialog`, `PinResetDialog`,
 * `NotebookDialog` and `ShareDialog` each carried their own copy of the same
 * 30-line effect — Escape, a Tab cycle wrapping at both ends, `activeElement`
 * restore — and each got it slightly differently right. They split arbitrarily
 * between `kairos-menu-surface` and `kairos-system-card-elevated`, sat at three
 * different z-indexes (65, 70 and, for the confirmations, 100), and put their
 * buttons at three different distances from the last field.
 *
 * None of them was portalled, which was not a style preference but a bug: they
 * rendered inside a `<main>` wearing `.kairos-page-enter`, whose animation ends
 * on a real `transform`, and a computed transform makes an element a containing
 * block for `position: fixed` descendants. `fixed inset-0` therefore resolved
 * against the shell rather than the viewport. `ui/Overlay` has a comment
 * explaining exactly this and notes imported it nowhere.
 *
 * So the behaviour comes from `ui/Modal` — the trap, Escape, the portal, the
 * body-scroll lock, focus restore — and what is left here is the shell and the
 * exit. The exit is the reason to consolidate now rather than later: holding a
 * dialog on screen for the length of its `--out` animation needs a mount/unmount
 * delay, and writing that five times is how five copies drift apart again.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff } from "~/components/ui/icons";
import { toNotePassword } from "~/lib/notePassword";

import { Modal, ModalDismiss } from "~/components/ui/Modal";

import { DIALOG_EXIT_MS, exitMs } from "./notesMotion";
import { DIALOG_SURFACE } from "./notesUi";

/* ── The dialog dialect ───────────────────────────────────────────────────
   The front door's language rather than a component kit's: a mono eyebrow in
   the accent over a display-serif title, fields drawn as a single underline,
   a text-only cancel, and a destructive action in danger ink on a danger
   hairline — never a solid red fill. The icon tile, the boxed inputs and the
   tinted call-out cards these dialogs used to wear were the generic look this
   replaces. See `SignInModal` and `ui/Modal`'s shell for the originals. */

/** The field shell: an underline that warms to the accent on focus. */
export const DIALOG_FIELD =
  "flex h-[44px] items-center gap-3 border-b border-fg-primary/[0.14] transition-colors duration-300 focus-within:border-accent-primary";
const DIALOG_FIELD_TALL =
  "flex items-start gap-3 border-b border-fg-primary/[0.14] py-2.5 transition-colors duration-300 focus-within:border-accent-primary";
/** The input itself, inside a `DIALOG_FIELD`. */
export const DIALOG_INPUT =
  "min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-fg-primary caret-accent-primary outline-none placeholder:text-fg-primary/30";
const DIALOG_LABEL = "block text-[12px] font-medium text-fg-tertiary";

const DIALOG_BTN =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-5 text-[13.5px] font-semibold transition-[opacity,background-color,border-color,color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35";
/** The one that does the thing: ink on ground, the accent left for meaning. */
export const DIALOG_PRIMARY = `${DIALOG_BTN} bg-fg-primary text-bg-primary hover:opacity-90`;
/** The one that destroys something. */
export const DIALOG_DANGER = `${DIALOG_BTN} border border-status-danger-border bg-status-danger-surface text-status-danger-ink hover:border-status-danger-ink`;
/** The one that leaves: a text link, so there is only ever one button to find. */
export const DIALOG_QUIET =
  "inline-flex h-10 items-center justify-center px-2 text-[13.5px] font-medium text-fg-tertiary transition-colors hover:text-fg-primary disabled:pointer-events-none disabled:opacity-35";

/**
 * Keeps a dialog mounted while it animates out.
 *
 * `closing` drives the `--out` class; `requestClose` starts the exit and calls
 * the caller's `onClose` once it has elapsed. Guarded against being asked twice,
 * because a scrim click, an Escape and a Cancel press can all arrive within one
 * exit and the second would restart the timer.
 */
export function useDialogExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* A ref, so a caller re-creating `onClose` each render does not invalidate
     `requestClose` — the same reason `useModalBehavior` holds its dismiss in
     one. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const requestClose = useCallback(() => {
    setClosing((already) => {
      if (already) return already;
      timer.current = setTimeout(() => closeRef.current(), exitMs(DIALOG_EXIT_MS));
      return true;
    });
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { closing, requestClose };
}

const SIZES = {
  sm: "max-w-[400px]",
  md: "max-w-[440px]",
  lg: "max-w-[500px]",
} as const;

/**
 * The shell: an eyebrow and a serif title, a body, and a footer holding the
 * actions.
 *
 * The footer matters more than it looks. Every one of the five dialogs used to
 * end with `flex gap-3 mt-5` inline after whatever its last field was, so the
 * primary action landed in a different place in each. Here it is always in the
 * same corner, under the same hairline.
 */
export function NotesDialog({
  eyebrow,
  title,
  subtitle,
  size = "md",
  role = "dialog",
  onClose,
  onSubmit,
  /** Rendered at the left of the footer, opposite the actions. */
  footerNote,
  actions,
  /** Focused on open, overriding the trap's "first focusable" — see below. */
  initialFocusRef,
  children,
}: {
  /** A mono stamp above the title naming what the dialog is about. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  size?: keyof typeof SIZES;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  /** When given, the shell is a `<form>` and this runs on submit. */
  onSubmit?: () => void;
  footerNote?: ReactNode;
  actions: (helpers: { close: () => void }) => ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const t = useTranslations("notes");
  const titleId = useId();
  const { closing, requestClose } = useDialogExit(onClose);

  /* `useModalBehavior` focuses the first focusable in the card, which here is
     the header's close button — never what the user wants to type into. Runs
     after it and overrides it, the way `ui/ConfirmDialog` does for its gate. */
  useEffect(() => {
    initialFocusRef?.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inner = (
    <>
      <header className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-2.5 font-mono text-[10.5px] tracking-[0.2em] text-accent-primary uppercase">
              {eyebrow}
            </p>
          )}
          <h2
            id={titleId}
            className="font-display text-[26px] leading-[1.1] font-normal tracking-[-0.01em] text-fg-primary"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-2 text-[13.5px] leading-relaxed text-fg-tertiary">{subtitle}</p>
          )}
        </div>
        <ModalDismiss onDismiss={requestClose} label={t("common.close")} className="-mr-1" />
      </header>

      <div className="px-6 pt-6 pb-6">{children}</div>

      <footer className="flex items-center gap-3 border-t border-border-light/70 px-6 py-4">
        {footerNote ? <span className="mr-auto min-w-0">{footerNote}</span> : <span className="mr-auto" />}
        {actions({ close: requestClose })}
      </footer>
    </>
  );

  return (
    <Modal
      role={role}
      labelledBy={titleId}
      onDismiss={requestClose}
      overlayClassName={`bg-black/55 backdrop-blur-[3px] ${closing ? "notes-scrim--out" : "notes-scrim"}`}
      /* The dialog is portalled to <body>, outside the workspace's `.notes-quiet`
         wrapper, so it re-declares the scope here to keep the warm palette. The
         `.dark .notes-quiet` rule still matches — `.dark` sits on <html>, above
         the portal. */
      className={`notes-quiet w-full ${SIZES[size]} ${DIALOG_SURFACE} ${closing ? "notes-dialog--out" : "notes-dialog"}`}
    >
      {onSubmit ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {inner}
        </form>
      ) : (
        inner
      )}
    </Modal>
  );
}

/** A labelled field. The label is small and quiet; the value is not. */
export function DialogField({
  id,
  label,
  hint,
  multiline = false,
  /** Adds the shake when what was submitted came back rejected. */
  invalid = false,
  children,
}: {
  id: string;
  label: string;
  /** A PIN hint, a help line — anything explaining the field rather than naming it. */
  hint?: ReactNode;
  multiline?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-6 last:mb-0">
      <label htmlFor={id} className={DIALOG_LABEL}>
        {label}
      </label>
      <div
        className={`${multiline ? DIALOG_FIELD_TALL : DIALOG_FIELD} ${invalid ? "notes-shake border-error" : ""}`}
      >
        {children}
      </div>
      {hint && <p className="mt-2 text-[11.5px] text-fg-quaternary">{hint}</p>}
    </div>
  );
}

/**
 * A password field with its own reveal toggle.
 *
 * Four of the five dialogs hand-rolled this — an absolutely positioned button
 * at `right-2.5 top-1/2 -translate-y-1/2` over a `pr-10` input — and a fifth
 * shared one `reveal` flag across three separate inputs. Here the toggle is a
 * flex sibling inside the field shell, so there is nothing to position and the
 * shell's focus ring covers both.
 */
export function DialogPasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete = "new-password",
  hint,
  inputRef,
  onEnter,
  /** Adds the shake when a submitted password came back rejected. */
  invalid = false,
  /** A password being set: digits only, with the numeric keypad on touch. */
  numeric = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete?: string;
  hint?: ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnter?: () => void;
  invalid?: boolean;
  numeric?: boolean;
}) {
  const t = useTranslations("notes");
  const [reveal, setReveal] = useState(false);

  return (
    <div className="mb-6 last:mb-0">
      <label htmlFor={id} className={DIALOG_LABEL}>
        {label}
      </label>
      <div className={`${DIALOG_FIELD} ${invalid ? "notes-shake border-error" : ""}`}>
        <input
          id={id}
          ref={inputRef}
          type={reveal ? "text" : "password"}
          inputMode={numeric ? "numeric" : undefined}
          value={value}
          onChange={(event) =>
            onChange(numeric ? toNotePassword(event.target.value) : event.target.value)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={invalid ? "true" : undefined}
          className={DIALOG_INPUT}
        />
        <button
          type="button"
          onClick={() => setReveal((previous) => !previous)}
          aria-label={reveal ? t("password.hide") : t("password.show")}
          className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-md text-fg-quaternary transition-colors hover:text-fg-primary"
        >
          {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {hint && <p className="mt-2 text-[11.5px] text-fg-quaternary">{hint}</p>}
    </div>
  );
}

/**
 * A block of consequence, set as a marginal note — a rule down its left edge
 * rather than a tinted card, so it reads as part of the page it sits on.
 *
 * The three tones are the three things these dialogs have to say: something is
 * missing and must be dealt with here (`warning`), something is about to stop
 * protecting you (`danger`), and a plain fact worth reading before the button
 * (`calm`). `warning` reveals by height, because the no-recovery-PIN branch
 * grows the dialog by ~120px and used to do it between two renders.
 */
export function DialogBlock({
  tone = "calm",
  title,
  children,
  reveal = false,
}: {
  tone?: "calm" | "warning" | "danger";
  /**
   * Optional, because some of these blocks are a single sentence that already
   * reads as one thought — `notes.password.protectWarning` and
   * `removeWarning` both are — and splitting a sentence in half to manufacture
   * a heading would mean inventing copy the translations do not have.
   */
  title?: string;
  children?: ReactNode;
  reveal?: boolean;
}) {
  const rules = {
    calm: "border-fg-primary/15",
    warning: "border-warning/70",
    danger: "border-error/70",
  } as const;
  const heads = {
    calm: "text-fg-primary",
    warning: "text-warning",
    danger: "text-error",
  } as const;

  return (
    <div className={`mt-6 border-l-[1.5px] pl-4 ${rules[tone]} ${reveal ? "notes-strip" : ""}`}>
      {title && <p className={`text-[13px] font-semibold ${heads[tone]}`}>{title}</p>}
      {children && (
        <div className={`text-[12.5px] leading-relaxed text-fg-secondary ${title ? "mt-1.5" : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A validation or server error, arriving rather than appearing. */
export function DialogError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="calendar-pop mt-3 flex items-center gap-1.5 text-[12px] text-error"
    >
      <AlertCircle size={12} className="flex-none" />
      {children}
    </p>
  );
}

/**
 * "Are you sure", in this surface's own chrome.
 *
 * The rest of the app asks through `ui/ConfirmDialog`, whose card is the app
 * shell rather than this one — so deleting a note used to open a dialog that
 * looked nothing like the lock dialog beside it. This is the same question in
 * the same frame as every other notes dialog. It does not stay open on failure
 * the way `ConfirmDialog` can: every caller here closes it on confirm and lets
 * the mutation report through a toast.
 */
export function NotesConfirmDialog({
  eyebrow,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  isPending,
  onCancel,
  onConfirm,
}: {
  eyebrow?: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  return (
    <NotesDialog
      eyebrow={eyebrow}
      title={title}
      size="sm"
      role="alertdialog"
      onClose={onCancel}
      initialFocusRef={confirmRef}
      actions={({ close }) => (
        <>
          <button type="button" onClick={close} className={DIALOG_QUIET}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={destructive ? DIALOG_DANGER : DIALOG_PRIMARY}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      <p className="text-[14px] leading-relaxed text-fg-secondary">{message}</p>
    </NotesDialog>
  );
}
