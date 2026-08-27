import { auth } from "~/server/auth";
import { redirect } from "next/navigation";

import { OnboardingGate } from "~/components/auth/OnboardingGate";
import { NotesWorkspace } from "~/components/notes/NotesWorkspace";

/**
 * A blank note, open and ready to type into.
 *
 * It is not a row in the database yet: `note.create` requires content, and an
 * empty page you clicked away from is not a note. The first pause in typing
 * creates it and replaces this route with `/notes/[noteId]`.
 */
export default async function NewNotePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <OnboardingGate>
      <div className="h-[100dvh] bg-bg-primary overflow-hidden">
        <main
          id="main-content"
          className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter kairos-topbar-gap kairos-bottomnav-gap"
        >
          <NotesWorkspace noteId={null} isDraft />
        </main>
      </div>
    </OnboardingGate>
  );
}
