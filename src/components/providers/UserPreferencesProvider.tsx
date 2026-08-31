"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { api } from "~/trpc/react";
import {
  applyNotificationPosition,
  isNotificationPosition,
  NOTIFICATION_POSITION_STORAGE_KEY,
} from "~/lib/notificationPosition";

const DEFAULT_ACCENT = "purple";

const normalizeAccent = (accent?: string | null) => {
  switch (accent) {
    case "purple":
    case "pink":
    case "caramel":
    case "mint":
    case "sky":
    case "strawberry":
      return accent;
    case "indigo":
      return "purple";
    case "cyan":
    case "teal":
    case "green":
      return "mint";
    case "blue":
      return "sky";
    default:
      return DEFAULT_ACCENT;
  }
};

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  const applied = useRef(false);
  const migratedAccent = useRef(false);

  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const enabled = status === "authenticated";

  const { data } = api.settings.get.useQuery(undefined, {
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const updateAppearance = api.settings.updateAppearance.useMutation();

  useEffect(() => {
    applied.current = false;
    migratedAccent.current = false;
  }, [userId]);

  useEffect(() => {
    if (!data?.accentColor) return;
    const raw = data.accentColor;
    const accent = normalizeAccent(raw);
    
    // Apply immediately and persist
    document.documentElement.dataset.accent = accent;
    
    /* localStorage, not sessionStorage: the accent is a durable preference, not
       something about this tab. Stored per-tab, the pre-paint script found
       nothing in every newly opened tab, painted the default purple, and
       corrected once the settings query came back — a visible flash on a value
       the user had already chosen. */
    try {
      localStorage.setItem('user-accent', accent);
    } catch {}

    if (!enabled) return;
    if (migratedAccent.current) return;
    if (raw !== accent) {
      migratedAccent.current = true;
      updateAppearance.mutate({ accentColor: accent });
    }
  }, [data?.accentColor, enabled, updateAppearance]);

  /* Same shape as the accent above, and for the same reason: the pre-paint
     script reads this from localStorage so a toast firing before hydration
     lands in the corner the user chose, which means the stored copy has to be
     kept in step with the server's whenever the query resolves. */
  useEffect(() => {
    const position = data?.notificationPosition;
    if (!isNotificationPosition(position)) return;

    applyNotificationPosition(position, document.documentElement);
    try {
      localStorage.setItem(NOTIFICATION_POSITION_STORAGE_KEY, position);
    } catch {}
  }, [data?.notificationPosition]);

  useEffect(() => {
    if (applied.current) return;
    if (!data?.theme) return;
    applied.current = true;
    setTheme(data.theme);
  }, [data?.theme, setTheme]);

  return children;
}
