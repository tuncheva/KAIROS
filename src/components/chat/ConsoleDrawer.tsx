"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useModalBehavior } from "~/components/ui/Modal";
import { Overlay } from "~/components/ui/Overlay";
import { exitDurationMs } from "~/components/ui/drawerExit";

/**
 * A side panel of the AI console, pulled out over the conversation when the
 * console is too narrow to keep it as a column.
 *
 * The same sheet as `TaskDrawer` — a floating pane over a blurred scrim, the
 * `projects-drawer` slide in and out — so the console's drawers move like
 * every other drawer in the app. It portals for the reason `Overlay` gives:
 * inside the shell, `fixed` resolves against the page-enter transform rather
 * than the viewport and the sheet lands inset past the nav rail.
 */
export function ConsoleDrawer({
  open,
  onClose,
  side,
  label,
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  /** Accessible name of the sheet. */
  label: string;
  /** Accessible name of the scrim, which closes it. */
  closeLabel: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Latched past `open` so the exit has time to play; see `TaskDrawer`. */
  const [mounted, setMounted] = useState(open);
  const closing = mounted && !open;

  useEffect(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    exitTimer.current = setTimeout(() => setMounted(false), exitDurationMs());
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
    // `mounted` is set by this effect; depending on it would restart the
    // exit timer mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useModalBehavior({ containerRef: panelRef, onDismiss: onClose, enabled: mounted && !closing });

  if (!mounted) return null;

  const left = side === "left";

  return (
    <Overlay>
      <div
        className={`chat-refined fixed inset-0 z-[60] flex ${left ? "justify-start" : "justify-end"} ${
          closing ? "pointer-events-none" : ""
        }`}
      >
        <button
          type="button"
          aria-label={closeLabel}
          tabIndex={-1}
          onClick={onClose}
          disabled={closing}
          className={`absolute inset-0 bg-black/55 backdrop-blur-[6px] ${
            closing ? "projects-drawer-scrim-out" : "projects-drawer-scrim"
          }`}
        />

        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={`relative m-2 flex h-[calc(100%-1rem)] w-full flex-col overflow-hidden rounded-[16px] border border-tui-ink/10 bg-tui-pane text-tui-ink shadow-[var(--tui-pane-shadow)] sm:m-3 sm:h-[calc(100%-1.5rem)] ${
            left ? "max-w-[320px]" : "max-w-[380px]"
          } ${
            left
              ? closing
                ? "console-drawer-left-out"
                : "console-drawer-left"
              : closing
                ? "projects-drawer-out"
                : "projects-drawer"
          }`}
        >
          {children}
        </aside>
      </div>
    </Overlay>
  );
}
