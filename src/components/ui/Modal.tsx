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
      className={`fixed inset-0 z-[100] grid place-items-center overflow-y-auto overscroll-contain bg-black/60 p-4 ${overlayClassName}`}
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
