"use client";

/**
 * The dialog behaviour every modal in the app is supposed to have.
 *
 * The newer surfaces — `notes/*`, `chat/*`, `CalendarDrawer`,
 * `NewProjectDrawer`, `CommandPalette` — each grew their own correct copy of
 * this: `role`, `aria-modal`, Escape, a Tab cycle that wraps at both ends, and
 * `activeElement` restore on close. The older ones grew none of it, and the
 * two a *first-time* user must get through — `SignInModal`, the front door,
 * and `RoleSelectionModal`, onboarding — were among them.
 *
 * Two exports, because the surfaces genuinely differ:
 *
 * - `useModalBehavior` is the behaviour alone, for a dialog that owns its own
 *   chrome (a split-panel sign-in box is not a centred card, and wrapping it
 *   in one would be a rewrite rather than a fix).
 * - `Modal` is that hook plus the backdrop, the portal and the card, for the
 *   dialogs that are just a card.
 *
 * The body-scroll lock lives here too. No overlay in the app had one, which on
 * iOS lets the page behind scroll under your finger while the dialog is open.
 */

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalBehavior({
  containerRef,
  onDismiss,
  /** Some dialogs are a step in a flow and must not be escapable. */
  dismissOnEscape = true,
  /**
   * False while the dialog is not on screen.
   *
   * Hooks cannot be called conditionally, so a component that returns early
   * when closed would otherwise lock body scroll for the lifetime of the page
   * — `SignInModal` is mounted on the landing page from the first paint and is
   * closed almost all of the time.
   */
  enabled = true,
}: {
  containerRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  dismissOnEscape?: boolean;
  enabled?: boolean;
}) {
  /* A ref, so changing the handler between renders does not tear down and
     rebuild the listener — and, more importantly, does not re-run the effect
     and steal focus back to the first element mid-interaction. */
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;

    const restoreTo = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    const first = container?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissOnEscape) {
        e.preventDefault();
        dismissRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;
      const head = focusable[0]!;
      const tail = focusable[focusable.length - 1]!;

      /* Wrap at both ends, so Tab can never walk out of the dialog into the
         page behind it — which is where a screen reader then reads content the
         user cannot see. */
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };

    document.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo?.focus();
    };
  }, [containerRef, dismissOnEscape, enabled]);
}

export function Modal({
  labelledBy,
  describedBy,
  label,
  onDismiss,
  dismissOnEscape,
  role = "dialog",
  className = "",
  overlayClassName = "",
  children,
}: {
  /** Id of the element naming the dialog. Use `label` when there is no title. */
  labelledBy?: string;
  describedBy?: string;
  label?: string;
  onDismiss: () => void;
  dismissOnEscape?: boolean;
  /** `alertdialog` for a destructive confirmation, `dialog` otherwise. */
  role?: "dialog" | "alertdialog";
  className?: string;
  /**
   * Replaces the backdrop's look — its colour, blur and any entrance
   * animation. Layout (`fixed inset-0`, the centring grid, the scroll
   * container) is not negotiable and stays here.
   *
   * A replacement rather than an addition: Tailwind resolves two competing
   * utilities by their order in the generated stylesheet, not by their order in
   * the class attribute, so appending `bg-black/40` to a hard-coded
   * `bg-black/60` would win or lose unpredictably.
   */
  overlayClassName?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Portals need a DOM to aim at, which the server render does not have.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useModalBehavior({ containerRef, onDismiss, dismissOnEscape });

  if (!mounted) return null;

  return createPortal(
    /* Onto `document.body` rather than in place: callers sit inside ancestors
       carrying transforms and filters, and a `position: fixed` overlay inside
       one of those is contained by it rather than by the viewport — the
       backdrop covers part of the page and the card lands wherever the caller
       is. */
    <div
      className={`fixed inset-0 z-[100] grid place-items-center overflow-y-auto overscroll-contain p-4 ${overlayClassName || "bg-black/60"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={containerRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={className}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   The dialog shell.

   `Modal` above is the behaviour; these are the chrome. Modals in this app used
   to ship at four different radii (`rounded-2xl`, `rounded-3xl`, `[18px]`,
   `[32px]`), on three different surfaces, with the close control drawn as a
   glyph in whatever icon set the file happened to import and the actions
   floating wherever the last paragraph ended.

   One shell now: 16px radius on `bg-overlay`, a hairline header carrying a
   serif title and a mono ESC affordance instead of a glyph, a body on the
   dialog padding step, and a hairline footer with the actions right-aligned —
   destructive in danger ink on a danger hairline, never a solid red fill.
   ──────────────────────────────────────────────────────────────────────────── */

/** The card itself. Callers add their own width and max-height. */
export const MODAL_SHELL =
  "flex flex-col overflow-hidden rounded-xl border border-border-light bg-bg-overlay shadow-2xl";

/** The scrim under it. */
export const MODAL_SCRIM = "bg-black/60 backdrop-blur-sm";

/**
 * The one dismiss affordance. A key name rather than a glyph: it says how to
 * close the dialog from the keyboard, which the cross never did.
 *
 * `className` positions it — most headers let it sit in the flow, drawers that
 * float it over their own content pass the absolute placement.
 */
export function ModalDismiss({
  onDismiss,
  /** Accessible name. Supply the translated "Close". */
  label = "Close",
  className = "",
  /** Marks this as the dialog's initial focus target. */
  autoFocus = false,
}: {
  onDismiss: () => void;
  label?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={label}
      {...(autoFocus ? { "data-autofocus": true } : {})}
      className={`kairos-tap inline-flex h-control-sm flex-none items-center rounded-sm border border-border-light px-2 font-mono text-[10px] tracking-[0.14em] text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-primary ${className}`.trim()}
    >
      ESC
    </button>
  );
}

export function ModalHeader({
  id,
  title,
  eyebrow,
  onDismiss,
  /** Accessible name for the close control. Supply the translated "Close". */
  closeLabel = "Close",
}: {
  id?: string;
  title: ReactNode;
  /** A mono stamp above the title — "STEP 2 OF 3", "ERROR · 500". */
  eyebrow?: ReactNode;
  onDismiss?: () => void;
  closeLabel?: string;
}) {
  return (
    <header className="flex flex-none items-start justify-between gap-3 border-b border-border-light px-pad-dialog py-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 font-mono text-[10px] tracking-[0.16em] text-fg-quaternary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={id}
          className="font-display text-[19px] leading-tight font-normal text-fg-primary"
        >
          {title}
        </h2>
      </div>
      {onDismiss ? (
        <ModalDismiss onDismiss={onDismiss} label={closeLabel} className="-mr-1" />
      ) : null}
    </header>
  );
}

export function ModalBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto px-pad-dialog py-4 ${className}`}>
      {children}
    </div>
  );
}

/** The footer. Actions are right-aligned, in the order cancel-then-confirm. */
export function ModalActions({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-none items-center justify-end gap-2.5 border-t border-border-light bg-bg-surface px-pad-dialog py-3 ${className}`}
    >
      {children}
    </div>
  );
}

const ACTION_BASE =
  "inline-flex h-control-md items-center justify-center rounded-md px-3.5 text-[13px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

export const MODAL_ACTION_TONES = {
  /** The one that closes without doing anything. */
  quiet:
    "border border-border-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
  /** The one that does the thing. */
  primary: "bg-accent-primary text-white hover:bg-accent-hover",
  /** The one that destroys something: danger ink on a danger hairline. */
  danger:
    "border border-status-danger-border bg-status-danger-surface text-status-danger-ink hover:border-status-danger-ink",
} as const;

export function ModalAction({
  tone = "quiet",
  className = "",
  ref,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: keyof typeof MODAL_ACTION_TONES;
  /* React 19 passes `ref` as an ordinary prop, so no forwardRef needed. */
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      ref={ref}
      {...props}
      className={`${ACTION_BASE} ${MODAL_ACTION_TONES[tone]} ${className}`}
    />
  );
}
