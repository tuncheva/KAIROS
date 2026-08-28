"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface ComposerMenuOption {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Listed but not selectable — e.g. a scheduled agent with no chat surface. */
  disabled?: boolean;
}

interface Props {
  /** Rendered inside the closed chip, before the label. */
  icon?: ReactNode;
  label: string;
  title: string;
  options: ComposerMenuOption[];
  selected: string;
  onSelect: (id: string) => void;
  /** The agent chip is the primary one and carries the accent. */
  tone?: "accent" | "neutral";
}

/**
 * A chip in the composer that opens a short list.
 *
 * Both of the composer's pickers — who answers, and what they can see — are the
 * same control, so they are one component. They live in the composer rather
 * than in a settings pane because they describe the *next* message: a user who
 * changes the scope expects it to apply to what they are about to send, not
 * retroactively to the thread above.
 *
 * Closes on outside click and on Escape. Without the Escape path a keyboard
 * user who opened it by mistake has no way back to the textarea.
 */
export function ComposerMenu({
  icon,
  label,
  title,
  options,
  selected,
  onSelect,
  tone = "neutral",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        /*
         * A text chip, not a button.
         *
         * Both pickers used to be filled controls sitting directly under the
         * textarea, which gave the composer three competing surfaces before
         * the send button. A hairline ring is enough to say "pressable" at
         * this size, and it leaves the accent to mean one thing — who is
         * answering — instead of two.
         */
        className={`flex max-w-[190px] items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] transition-colors ${
          tone === "accent"
            ? "bg-accent-primary/[0.08] text-accent-primary shadow-[0_0_0_0.5px_rgb(var(--accent-primary)/0.4)] hover:bg-accent-primary/15"
            : "text-fg-tertiary shadow-[0_0_0_0.5px_rgb(var(--border-medium)/0.8)] hover:text-fg-secondary"
        }`}
      >
        {icon}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="kairos-menu-surface absolute bottom-[calc(100%+6px)] left-0 z-30 max-h-72 w-72 overflow-y-auto rounded-xl p-1.5"
        >
          {options.map((option) => {
            const isSelected = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                onClick={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isSelected ? "bg-accent-primary/10" : "hover:bg-bg-tertiary"
                }`}
              >
                {option.icon && (
                  <span className="mt-0.5 shrink-0 text-fg-tertiary">
                    {option.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg-primary">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block text-xs leading-snug text-fg-tertiary">
                      {option.description}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-primary" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
