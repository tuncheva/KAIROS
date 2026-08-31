"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** How many toasts are on screen at once. A burst of activity used to be able
 *  to stack cards down the whole viewport in the notification popups; the same
 *  mistake is not worth repeating here. Oldest fall off first. */
const MAX_VISIBLE = 3;

/** An error is the one kind a user may need to read twice before acting on. */
const TTL_MS: Record<ToastKind, number> = {
  success: 3000,
  info: 3000,
  error: 6000,
};

class ToastManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly setToasts: React.Dispatch<React.SetStateAction<Toast[]>>) {}

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  remove = (id: string) => {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    this.setToasts((prev) => prev.filter((x) => x.id !== id));
  };

  push = (kind: ToastKind, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.setToasts((prev) => {
      const next = [...prev, { id, kind, message }];
      /* Drop the oldest rather than refusing the newest: the most recent
         message is the one that describes what the user just did. */
      const overflow = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
      for (const stale of overflow) {
        const timer = this.timers.get(stale.id);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(stale.id);
        }
      }
      return next.slice(-MAX_VISIBLE);
    });
    const t = setTimeout(() => this.remove(id), TTL_MS[kind]);
    this.timers.set(id, t);
  };
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 11,
    height: 11,
    "aria-hidden": true,
  };

  if (kind === "success") {
    return (
      <svg {...common}>
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg {...common}>
        <path d="M12 8v5M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" strokeWidth={2} />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function ToastItem({
  toast,
  onDismiss,
  dismissLabel,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  dismissLabel: string;
}) {
  return (
    <li className="toast-item" data-kind={toast.kind}>
      <span className="toast-icon">
        <ToastIcon kind={toast.kind} />
      </span>
      <span className="toast-text">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={dismissLabel}
        className="-mr-0.5 -mt-0.5 flex-none rounded-md p-1 text-fg-quaternary transition-colors hover:text-fg-primary"
      >
        <svg
          viewBox="0 0 24 24"
          width={12}
          height={12}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const t = useTranslations("common");

  const managerRef = useRef<ToastManager | null>(null);
  managerRef.current ??= new ToastManager(setToasts);

  useEffect(() => {
    const manager = managerRef.current;
    return () => manager?.dispose();
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => managerRef.current?.push(kind, message),
    []
  );

  const dismiss = useCallback((id: string) => managerRef.current?.remove(id), []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push]
  );

  /* Two live regions rather than one. A save confirmation should not interrupt
     a screen reader mid-sentence; a failure should. Both lists stay mounted so
     the assistive tech has a region to observe before anything lands in it. */
  const errors = toasts.filter((x) => x.kind === "error");
  const others = toasts.filter((x) => x.kind !== "error");
  const dismissLabel = t("dismissNotification");

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label={t("notifications")}>
        <div className="flex w-full flex-col gap-2 sm:w-auto">
          <ol className="toast-stack" role="alert" aria-live="assertive" aria-atomic="false">
            {errors.map((toast) => (
              <ToastItem
                key={toast.id}
                toast={toast}
                onDismiss={dismiss}
                dismissLabel={dismissLabel}
              />
            ))}
          </ol>
          <ol className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
            {others.map((toast) => (
              <ToastItem
                key={toast.id}
                toast={toast}
                onDismiss={dismiss}
                dismissLabel={dismissLabel}
              />
            ))}
          </ol>
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
