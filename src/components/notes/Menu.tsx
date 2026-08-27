"use client";

/**
 * A small anchored menu.
 *
 * The old context menu was a `div` that appeared on click, closed via a
 * full-screen invisible overlay, and could not be reached or dismissed from the
 * keyboard at all. This is the same shape with the behaviour a menu owes you:
 * `role="menu"`, Escape to close, focus returned to the trigger, arrow keys
 * between items, and a click outside that does not need an overlay to notice.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

export function Menu({
  label,
  icon,
  align = "right",
  triggerClassName,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
  /** Rendered open only. `close` lets an item dismiss the menu after acting. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
      if (!items || items.length === 0) return;
      event.preventDefault();

      const list = Array.from(items);
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? list[(index + 1) % list.length]
          : list[(index - 1 + list.length) % list.length];
      next?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={
          triggerClassName ??
          "p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
        }
      >
        {icon}
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`absolute z-30 top-full mt-1 min-w-[180px] max-h-[280px] overflow-y-auto p-1.5 rounded-xl bg-bg-elevated kairos-menu-surface ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  onClick,
  destructive = false,
  disabled = false,
  children,
}: {
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors disabled:opacity-40 ${
        destructive
          ? "text-fg-secondary hover:bg-error/10 hover:text-error"
          : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
      }`}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-border-light/50" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-[9.5px] font-semibold uppercase tracking-widest text-fg-quaternary">
      {children}
    </p>
  );
}
