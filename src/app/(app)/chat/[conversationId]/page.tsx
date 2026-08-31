import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { notFound, redirect } from "next/navigation";

import { ChatShell } from "~/components/chat/ChatShell";

/**
 * A conversation is a route, not component state.
 *
 * That is what makes the browser back button work when the mobile layout swaps
 * the rail for the thread, lets a notification link land on the right thread,
 * and keeps the URL shareable between the two people in it.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  /* Resolved before the session check so an expired session can be sent back
     to this exact note/conversation rather than the list. */
  const { conversationId } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect(signInHref(`/chat/${conversationId}`));
  }
  const id = Number(conversationId);
  /* `/chat/ai` is a sibling static route so it never reaches this file, but any
     other non-numeric path would otherwise become a query for conversation NaN. */
  if (!Number.isInteger(id) || id <= 0) notFound();

  return (
    <div className="h-[100dvh] bg-bg-primary overflow-hidden">
      <main
        id="main-content"
        className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter kairos-topbar-gap kairos-bottomnav-gap"
      >
        <ChatShell userId={session.user.id} conversationId={id} />
      </main>
    </div>
  );
}
