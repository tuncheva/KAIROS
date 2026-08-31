"use client";

import { useCallback } from "react";
import { api } from "~/trpc/react";
import { RoleSelectionModal } from "~/components/auth/RoleSelectionModal";

/**
 * Holds a user who has not chosen a usage mode yet.
 *
 * Three defects lived in the previous eight lines, all of them about *when*
 * the gate decides:
 *
 *  - It rendered `children` while the status query was in flight, so the
 *    dashboard painted and the modal slammed over it a moment later. Returning
 *    `null` instead costs one frame of blank and removes the flash.
 *  - Completion was tracked in `useState`, which every navigation threw away.
 *    Until the mutation landed and the query refetched, the gate re-armed on
 *    each page — a user could answer it twice. The answer now lives in the
 *    query cache, which is where the question lives, so a completed onboarding
 *    stays completed across the whole session.
 *  - It was mounted on `/create` and `/notes/*` only, while sign-in lands on
 *    `/dashboard`. Most users never met it. It is mounted on the dashboard too
 *    now; wave 3 moves it into `(app)/layout.tsx` and this becomes one mount.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const utils = api.useUtils();

  const { data: onboarding, isLoading } = api.user.checkOnboardingStatus.useQuery(undefined, {
    staleTime: 60_000,
  });

  /* Write the answer into the cache before the refetch confirms it. The modal's
     own mutations invalidate this key; this is what keeps the gate shut in the
     gap between "the user answered" and "the server agrees". */
  const handleComplete = useCallback(() => {
    utils.user.checkOnboardingStatus.setData(undefined, (previous) =>
      previous ? { ...previous, needsOnboarding: false } : previous,
    );
    void utils.user.checkOnboardingStatus.invalidate();
  }, [utils]);

  if (isLoading) return null;

  if (onboarding?.needsOnboarding) {
    return (
      <div className="min-h-dvh bg-bg-primary flex items-start justify-center">
        <RoleSelectionModal isOpen onComplete={handleComplete} />
      </div>
    );
  }

  return <>{children}</>;
}
