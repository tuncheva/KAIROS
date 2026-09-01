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
import { AlertCircle, Eye, EyeOff, X } from "~/components/ui/icons";

import { Modal } from "~/components/ui/Modal";

import { DIALOG_EXIT_MS, exitMs } from "./notesMotion";
import { DIALOG_SURFACE, FIELD, FIELD_INPUT, FIELD_LABEL, FIELD_TALL, ICON_BTN_BARE } from "./notesUi";

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
  sm: "max-w-[360px]",
  md: "max-w-[420px]",
  lg: "max-w-[480px]",
} as const;

/**
 * The shell: a header with an outlined icon tile, a body, and a footer holding
 * the actions.
 *
 * The footer matters more than it looks. Every one of the five dialogs used to
 * end with `flex gap-3 mt-5` inline after whatever its last field was, so the
 * primary action landed in a different place in each. Here it is always in the
 * same corner of the same tinted strip.
 */
export function NotesDialog({
  icon,
  tone = "accent",
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
  icon: ReactNode;
  tone?: "accent" | "error" | "warning";
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

  const tones = {
    accent: "border-accent-primary/30 text-accent-primary",
    error: "border-error/35 text-error",
    warning: "border-warning/40 text-warning",
  } as const;

  const inner = (
    <>
      <div className="flex items-start gap-3 px-4 pt-4">
        <span
          aria-hidden="true"
          className={`grid h-8 w-8 flex-none place-items-center rounded-[9px] border ${tones[tone]}`}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[15.5px] font-bold tracking-[-0.014em] text-fg-primary">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-tertiary">{subtitle}</p>}
        </span>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t("common.close")}
          className={ICON_BTN_BARE}
        >
          <X size={15} />
        </button>
      </div>

      <div className="px-4 py-4">{children}</div>

      <div className="flex items-center gap-2.5 border-t border-border-light/50 bg-bg-surface px-4 py-3">
        {footerNote ? <span className="mr-auto min-w-0">{footerNote}</span> : <span className="mr-auto" />}
        {actions({ close: requestClose })}
      </div>
    </>
  );

  return (
    <Modal
      role={role}
      labelledBy={titleId}
      onDismiss={requestClose}
      overlayClassName={`bg-black/40 backdrop-blur-sm ${closing ? "notes-scrim--out" : "notes-scrim"}`}
      className={`w-full ${SIZES[size]} ${DIALOG_SURFACE} ${closing ? "notes-dialog--out" : "notes-dialog"}`}
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

/** A labelled field. The label is mono and quiet; the value is not. */
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
    <div className="mb-3.5 last:mb-0">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <div
        className={`${multiline ? FIELD_TALL : FIELD} ${invalid ? "notes-shake border-error/55" : ""}`}
      >
        {children}
      </div>
      {hint && <p className="mt-1.5 text-[11.5px] text-fg-quaternary">{hint}</p>}
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
}) {
  const t = useTranslations("notes");
  const [reveal, setReveal] = useState(false);

  return (
    <div className="mb-3.5 last:mb-0">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <div className={`${FIELD} ${invalid ? "notes-shake border-error/55" : ""}`}>
        <input
          id={id}
          ref={inputRef}
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={invalid ? "true" : undefined}
          className={FIELD_INPUT}
        />
        <button
          type="button"
          onClick={() => setReveal((previous) => !previous)}
          aria-label={reveal ? t("password.hide") : t("password.show")}
          className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-md text-fg-tertiary transition-colors hover:text-fg-primary"
        >
          {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-[11.5px] text-fg-quaternary">{hint}</p>}
    </div>
  );
}

/**
 * A block of consequence.
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
  const tones = {
    calm: "border-border-light/70 bg-bg-secondary",
    warning: "border-warning/30 bg-warning/[0.06]",
    danger: "border-error/30 bg-error/[0.06]",
  } as const;
  const heads = {
    calm: "text-fg-secondary",
    warning: "text-warning",
    danger: "text-error",
  } as const;

  return (
    <div
      className={`mt-4 rounded-[10px] border p-3.5 ${tones[tone]} ${reveal ? "notes-strip" : ""}`}
    >
      {title && (
        <p className={`text-[12.5px] font-bold tracking-[-0.005em] ${heads[tone]}`}>{title}</p>
      )}
      {children && (
        <div className={`text-[12px] leading-relaxed text-fg-tertiary ${title ? "mt-1.5" : ""}`}>
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
