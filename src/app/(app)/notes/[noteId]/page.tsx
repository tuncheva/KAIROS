import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { notFound, redirect } from "next/navigation";

import { NotesWorkspace } from "~/components/notes/NotesWorkspace";

/**
 * A note is a route, not component state.
 *
 * That is what makes the browser back button work when the mobile layout swaps
 * the list for the note, and lets a share notification land on the right one
 * instead of racing a timeout against the query.
 */
export default async function NotePageRoute({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  /* Resolved before the session check so an expired session can be sent back
     to this exact note/conversation rather than the list. */
  const { noteId } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect(signInHref(`/notes/${noteId}`));
  }
  const id = Number(noteId);
  /* `/notes/new` is a sibling static route so it never reaches this file, but
     any other non-numeric path would otherwise become a query for note NaN. */
  if (!Number.isInteger(id) || id <= 0) notFound();

  return (
      <div className="h-[100dvh] bg-bg-primary overflow-hidden">
        <main
          id="main-content"
          className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter kairos-topbar-gap kairos-bottomnav-gap"
        >
          <NotesWorkspace noteId={id} />
        </main>
      </div>
  );
}
