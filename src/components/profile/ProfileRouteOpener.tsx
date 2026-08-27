"use client";

/**
 * Turns `/profile/<id>` into "open the drawer on this person".
 *
 * Renders nothing. It exists because `ProfilePeekProvider` holds the open user
 * id and only a client component can reach into that context, while the route
 * segment that knows the id is a server component.
 *
 * Closing goes back rather than clearing the id, because otherwise dismissing
 * the drawer would leave you on this route's empty page and tapping the same
 * notification again would be a no-op — the URL would not have changed.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useProfilePeek } from "./ProfilePeekProvider";

export function ProfileRouteOpener({ userId }: { userId: string }) {
  const { openProfile, openUserId } = useProfilePeek();
  const router = useRouter();
  const opened = useRef(false);

  useEffect(() => {
    openProfile(userId);
  }, [userId, openProfile]);

  useEffect(() => {
    // The latch matters. Both effects run on mount, and the state set by the
    // first has not landed by the time the second reads it — so without
    // `opened`, a fresh visit sees `null`, calls `back()` and bounces straight
    // off the route it just arrived at.
    if (openUserId !== null) {
      opened.current = true;
      return;
    }
    if (opened.current) router.back();
    // `openUserId` is the whole signal; re-running on router identity would
    // bounce the route on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUserId]);

  return null;
}
