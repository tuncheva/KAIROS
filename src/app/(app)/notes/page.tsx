import { auth } from "~/server/auth";
import { redirect } from "next/navigation";

import { OnboardingGate } from "~/components/auth/OnboardingGate";
import { NotesWorkspace } from "~/components/notes/NotesWorkspace";

/**
 * The notes library with nothing open yet.
 *
 * Selecting a note routes to `/notes/[noteId]` rather than setting state, so
 * the back button, deep links from notifications and a shared URL all behave.
 */
export default async function NotesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <OnboardingGate>
      <div className="h-[100dvh] bg-bg-primary overflow-hidden">
        <main
          id="main-content"
          className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter pt-16 lg:pt-0 pb-24 lg:pb-0"
        >
          <NotesWorkspace noteId={null} />
        </main>
      </div>
    </OnboardingGate>
  );
}
