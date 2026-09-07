"use client";

import { useCallback, useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Focus trap                                                        */
/* ------------------------------------------------------------------ */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // A roving-tabindex grid parks its non-current cells at -1, and an
    // `opacity: 0` control is not somewhere to send focus either.
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Hold keyboard focus inside `ref` while `active`, and give it back on close.
 *
 * The drawer already said `aria-modal="true"`, which is a promise to assistive
 * technology that the rest of the page is unreachable. Nothing enforced it:
 * focus stayed wherever it was when the panel opened, Tab walked straight out
 * into the calendar behind the scrim, and closing the panel left focus on an
 * element that no longer existed — which drops it to `<body>` and loses the
 * user's place entirely.
 *
 * `onEscape` is handled here too, so every dismissible surface on the page
 * gets the same exit for free.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  /* Captured on open, restored on close. Held in a ref rather than state so
     restoring never depends on a render happening first. */
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    returnTo.current = document.activeElement as HTMLElement | null;

    /* Captured once here rather than read again in cleanup: by the time the
       effect tears down, React may already have detached the node, and the
       cleanup needs the element this effect actually trapped. */
    const container = ref.current;
    if (container) {
      // Prefer an explicitly marked target, else the first focusable thing,
      // else the container itself so focus is at least inside the trap.
      const initial =
        container.querySelector<HTMLElement>("[data-autofocus]") ??
        focusableWithin(container)[0] ??
        container;
      if (initial === container && !container.hasAttribute("tabindex")) {
        container.setAttribute("tabindex", "-1");
      }
      initial.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onEscape) {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const root = ref.current;
      if (!root) return;
      const items = focusableWithin(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;

      // Wrap at both ends, and pull focus back in if it has escaped already.
      if (!root.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only take focus back if it is still inside the surface being closed;
      // if the user has already clicked elsewhere, leave them there.
      const active = document.activeElement;
      if (!container || !active || container.contains(active) || active === document.body) {
        returnTo.current?.focus?.();
      }
    };
  }, [active, onEscape, ref]);
}

/* ------------------------------------------------------------------ */
/*  Dismiss on outside pointer                                        */
/* ------------------------------------------------------------------ */

/** Close on a pointer press outside `ref`. Escape is the keyboard route and
 *  lives in `useFocusTrap`, so the two are never duplicated. */
export function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [active, onDismiss, ref]);
}

/* ------------------------------------------------------------------ */
/*  Roving tabindex                                                   */
/* ------------------------------------------------------------------ */

export type RovingOptions = {
  /** Number of items in the set. */
  count: number;
  /** Items per row; 1 makes the set linear. */
  columns: number;
  /** Index that currently owns the tab stop. */
  index: number;
  onIndexChange: (next: number) => void;
  /** Called for Enter/Space on the focused item. */
  onActivate?: (index: number) => void;
  /** Left/right instead of a grid — used for the toolbar. */
  orientation?: "grid" | "horizontal";
};

/**
 * Arrow-key movement over a set that owns exactly one tab stop.
 *
 * This is what turns a month of eighty-plus tab stops into one. Every item
 * chip and every per-cell add button used to be individually tabbable in DOM
 * order, so reaching the 24th of the month meant pressing Tab past everything
 * before it, and there was no way to move by week at all.
 *
 * Returns a keydown handler for the container. The caller renders
 * `tabIndex={i === index ? 0 : -1}` on each item and focuses the current one.
 */
export function useRoving({
  count,
  columns,
  index,
  onIndexChange,
  onActivate,
  orientation = "grid",
}: RovingOptions) {
  return useCallback(
    (event: React.KeyboardEvent) => {
      if (count === 0) return;
      // Let a text field have its own arrow keys and Home/End.
      const target = event.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Alt is the "move the item" modifier; the grid must not also scroll.
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const clamp = (next: number) => Math.max(0, Math.min(count - 1, next));
      const rowStart = index - (index % columns);

      let next: number | null = null;
      switch (event.key) {
        case "ArrowRight":
          next = clamp(index + 1);
          break;
        case "ArrowLeft":
          next = clamp(index - 1);
          break;
        case "ArrowDown":
          next = orientation === "horizontal" ? null : clamp(index + columns);
          break;
        case "ArrowUp":
          next = orientation === "horizontal" ? null : clamp(index - columns);
          break;
        case "Home":
          next = orientation === "horizontal" ? 0 : rowStart;
          break;
        case "End":
          next = orientation === "horizontal" ? count - 1 : clamp(rowStart + columns - 1);
          break;
        case "Enter":
        case " ":
          if (onActivate) {
            event.preventDefault();
            onActivate(index);
          }
          return;
        default:
          return;
      }

      if (next === null || next === index) return;
      event.preventDefault();
      onIndexChange(next);
    },
    [columns, count, index, onActivate, onIndexChange, orientation],
  );
}

/**
 * Move DOM focus to the roving item when the index changes, but only while
 * focus already lives inside the set.
 *
 * Without that condition the grid would steal focus from the search field
 * every time the period changed, which is worse than not moving it at all.
 */
export function useRovingFocus(
  containerRef: React.RefObject<HTMLElement | null>,
  selector: string,
  index: number,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    if (!container.contains(document.activeElement)) return;
    container.querySelector<HTMLElement>(selector)?.focus();
  }, [containerRef, enabled, index, selector]);
}
