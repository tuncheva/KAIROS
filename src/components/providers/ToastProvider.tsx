"use client";

import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

class ToastManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly setToasts: React.Dispatch<React.SetStateAction<Toast[]>>,
    private readonly ttlMs: number
  ) {}

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
    this.setToasts((prev) => [...prev, { id, kind, message }]);
    const t = setTimeout(() => this.remove(id), this.ttlMs);
    this.timers.set(id, t);
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [, setToasts] = useState<Toast[]>([]);

  const managerRef = useRef<ToastManager | null>(null);
  managerRef.current ??= new ToastManager(setToasts, 3000);

  useEffect(() => {
    const manager = managerRef.current;
    return () => manager?.dispose();
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => managerRef.current?.push(kind, message),
    []
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
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
