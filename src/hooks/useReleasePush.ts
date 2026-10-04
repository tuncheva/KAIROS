"use client";

import { useCallback } from "react";
import { api } from "~/trpc/react";
import { unsubscribeFromPush } from "~/lib/pushClient";

/**
 * Detach this device from push before signing out.
 *
 * Without it a phone that changes hands keeps receiving the previous account's
 * lock-screen notifications, since the subscription row outlives the session.
 * Bounded so a slow network never holds up the sign-out itself; a row left
 * behind is cleaned up the first time the push service reports it gone.
 */
export function useReleasePush() {
  const unsubscribe = api.notification.pushUnsubscribe.useMutation();

  return useCallback(async () => {
    const release = (async () => {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await unsubscribe.mutateAsync({ endpoint });
    })().catch(() => undefined);

    await Promise.race([release, new Promise((resolve) => setTimeout(resolve, 1500))]);
  }, [unsubscribe]);
}
