import { auth } from "~/server/auth";
import { notFound, redirect } from "next/navigation";

import { OnboardingGate } from "~/components/auth/OnboardingGate";
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
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const { noteId } = await params;
  const id = Number(noteId);
  /* `/notes/new` is a sibling static route so it never reaches this file, but
     any other non-numeric path would otherwise become a query for note NaN. */
  if (!Number.isInteger(id) || id <= 0) notFound();

  return (
    <OnboardingGate>
      <div className="h-[100dvh] bg-bg-primary overflow-hidden">
        <main
          id="main-content"
          className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter pt-16 lg:pt-0 pb-24 lg:pb-0"
        >
          <NotesWorkspace noteId={id} />
        </main>
      </div>
    </OnboardingGate>
  );
}
