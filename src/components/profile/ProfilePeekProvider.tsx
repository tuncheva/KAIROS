"use client";

/**
 * One profile drawer for the whole signed-in app.
 *
 * Avatars appear in five surfaces — the events feed, event comments, the RSVP
 * list, project rows and the collaborator list — and each of them would
 * otherwise have to own a drawer, its open state and its queries. Instead every
 * one of them calls `openProfile(userId)` and this provider, mounted once in
 * `(app)/layout`, renders the single drawer.
 *
 * The open user id also lives in this context rather than in each caller, which
 * is what lets the drawer stay open across a navigation: tapping a shared
 * project inside the drawer routes the page underneath without unmounting the
 * drawer, because the drawer is a sibling of `children`, not a descendant.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "~/trpc/react";
import { ProfileDrawer } from "./ProfileDrawer";

interface ProfilePeekApi {
  /** Open the drawer on a user. Passing the id already open is a no-op. */
  openProfile: (userId: string) => void;
  closeProfile: () => void;
  openUserId: string | null;
}

const ProfilePeekContext = createContext<ProfilePeekApi | null>(null);

/**
 * How often the shell tells the server it is still here.
 *
 * Two minutes against a five-minute online window (`ONLINE_WINDOW_MS`), so a
 * single missed beat — a sleeping laptop, a dropped request — does not make
 * somebody blink offline. One `UPDATE` on one row every two minutes per open
 * tab is the whole cost.
 */
const HEARTBEAT_MS = 2 * 60 * 1000;

export function ProfilePeekProvider({ children }: { children: ReactNode }) {
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const heartbeat = api.profile.heartbeat.useMutation({
    // A failed heartbeat means a stale dot, not a broken page. Swallowed
    // rather than surfaced: there is nothing the viewer could do about it.
    onError: () => undefined,
  });

  useEffect(() => {
    const beat = () => {
      // A backgrounded tab is not presence. Skipping here is what stops a
      // browser left open overnight from reporting someone as online.
      if (document.visibilityState !== "visible") return;
      heartbeat.mutate();
    };

    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
    // `heartbeat` is a stable tRPC mutation handle; re-running this on every
    // render would restart the interval and beat on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProfile = useCallback((userId: string) => {
    if (!userId) return;
    setOpenUserId(userId);
  }, []);

  const closeProfile = useCallback(() => setOpenUserId(null), []);

  const value = useMemo<ProfilePeekApi>(
    () => ({ openProfile, closeProfile, openUserId }),
    [openProfile, closeProfile, openUserId],
  );

  return (
    <ProfilePeekContext.Provider value={value}>
      {children}
      <ProfileDrawer userId={openUserId} onClose={closeProfile} />
    </ProfilePeekContext.Provider>
  );
}

/**
 * Returns a no-op API outside the provider rather than throwing.
 *
 * The avatar components this feeds are also rendered on marketing and auth
 * pages, which sit outside `(app)` and have no drawer to open. Throwing there
 * would take the page down over a feature that simply does not apply.
 */
export function useProfilePeek(): ProfilePeekApi {
  const ctx = useContext(ProfilePeekContext);
  return ctx ?? FALLBACK;
}

const FALLBACK: ProfilePeekApi = {
  openProfile: () => undefined,
  closeProfile: () => undefined,
  openUserId: null,
};
