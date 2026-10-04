"use client";

import { useEffect } from "react";
import { api } from "~/trpc/react";
import { env } from "~/env";
import {
  getCurrentSubscription,
  isPushSupported,
  registerServiceWorker,
  serialize,
  setAppBadge,
} from "~/lib/pushClient";

/** Matches NotificationSystem's fallback poll, so the two share one cache entry. */
const UNREAD_POLL_MS = 60_000;

/**
 * Keeps this device's push subscription and Home Screen badge honest.
 *
 * - Registers `/sw.js` once per signed-in session, so a device that enabled push
 *   keeps a live worker after the browser evicts an idle one.
 * - Re-sends an existing subscription on every app open. Push services rotate
 *   endpoints, Safari never fires `pushsubscriptionchange`, and a different
 *   account signing in on the same phone needs the row moved to them — the
 *   server's upsert-on-endpoint covers all three.
 * - Mirrors the unread count onto the app icon, since the badge a push set
 *   otherwise stays stale after the user reads things in the app.
 *
 * Renders nothing.
 */
export function PushRegistrar() {
  const subscribe = api.notification.pushSubscribe.useMutation();
  const { data: unread } = api.notification.getUnreadCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: UNREAD_POLL_MS,
  });

  const { mutate } = subscribe;
  useEffect(() => {
    if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !isPushSupported()) return;
    let cancelled = false;
    void (async () => {
      await registerServiceWorker();
      if (cancelled || Notification.permission !== "granted") return;
      const sub = await getCurrentSubscription();
      const serialized = sub ? serialize(sub) : null;
      if (!cancelled && serialized) mutate(serialized);
    })();
    return () => {
      cancelled = true;
    };
  }, [mutate]);

  useEffect(() => {
    if (unread !== undefined) void setAppBadge(unread);
  }, [unread]);

  return null;
}
