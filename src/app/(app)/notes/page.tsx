import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";

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
    redirect(signInHref("/notes"));
  }

  return (
      <div className="h-[100dvh] bg-bg-primary overflow-hidden">
        <main
          id="main-content"
          className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter kairos-topbar-gap kairos-bottomnav-gap"
        >
          <NotesWorkspace noteId={null} />
        </main>
      </div>
  );
}
