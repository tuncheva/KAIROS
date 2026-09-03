import { notFound, redirect } from "next/navigation";

import { TopBar } from "~/components/layout/TopBar";
import { signInHref } from "~/lib/routes";
import { auth } from "~/server/auth";

import { RecoverClient } from "./RecoverClient";

/**
 * Recovery for one note, addressed as a child of that note.
 *
 * It used to be `/reset-password?noteId=…` under `(auth)`, which named the
 * wrong thing (account passwords are reset inside `SignInModal`) and put the
 * note's identity in a query string that could simply be missing. It also sat
 * outside the signed-in shell while calling `protectedProcedure`, so an
 * unauthenticated visitor got a raw `UNAUTHORIZED` instead of a sign-in box;
 * living under `(app)` is what makes the redirect below the normal path.
 */
export default async function RecoverNotePage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect(signInHref(`/notes/${noteId}/recover`));
  }

  const id = Number(noteId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  return (
    <div className="bg-bg-primary min-h-dvh">
      <div className="rail-offset kairos-topbar-gap kairos-bottomnav-gap flex min-h-dvh flex-col">
        <TopBar />
        <main id="main-content" className="kairos-page-enter flex-1">
          <RecoverClient noteId={noteId} />
        </main>
      </div>
    </div>
  );
}
