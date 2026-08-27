"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { RoleSelectionModal } from "~/components/auth/RoleSelectionModal";

/**
 * Shows the RoleSelectionModal for users who haven't picked a usageMode yet.
 * Renders children once onboarding is complete (or already done).
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const [dismissed, setDismissed] = useState(false);

  const { data: onboarding, isLoading } = api.user.checkOnboardingStatus.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (isLoading) return <>{children}</>;

  const needsOnboarding = onboarding?.needsOnboarding && !dismissed;

  if (needsOnboarding) {
    return (
      <div className="min-h-dvh bg-bg-primary flex items-start justify-center">
        <RoleSelectionModal isOpen onComplete={() => setDismissed(true)} />
      </div>
    );
  }

  return <>{children}</>;
}
