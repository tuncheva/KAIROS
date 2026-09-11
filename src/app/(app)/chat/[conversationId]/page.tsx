import { auth } from "~/server/auth";
import { TopBar } from "~/components/layout/TopBar";
import { signInHref } from "~/lib/routes";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { directConversations } from "~/server/db/schema";
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
     to this exact conversation rather than the list. */
  const { conversationId: param } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect(signInHref(`/chat/${param}`));
  }

  /* Resolve the URL segment — either a publicId string or a legacy numeric id —
     to the internal integer id that ChatShell uses. Numeric URLs are redirected
     to their publicId equivalent so links stabilise on the canonical form. */
  let numericId: number | null = null;
  const isNumeric = /^\d+$/.test(param);

  if (isNumeric) {
    const n = parseInt(param, 10);
    if (Number.isInteger(n) && n > 0) {
      const [convo] = await db
        .select({ id: directConversations.id, publicId: directConversations.publicId })
        .from(directConversations)
        .where(eq(directConversations.id, n))
        .limit(1);
      if (convo?.publicId) {
        redirect(`/chat/${convo.publicId}`);
      }
      /* Conversation exists but has no publicId yet (pre-migration row). Serve
         it at the numeric URL rather than 404-ing. */
      numericId = convo?.id ?? null;
    }
  } else {
    /* `/chat/ai` is a sibling static route so it never reaches this file.
       Any other non-numeric segment must be a publicId. */
    const [convo] = await db
      .select({ id: directConversations.id })
      .from(directConversations)
      .where(eq(directConversations.publicId, param))
      .limit(1);
    numericId = convo?.id ?? null;
  }

  if (!numericId) notFound();

  return (
    <div className="bg-bg-primary h-[100dvh] overflow-hidden">
      {/* These six full-height surfaces were the only signed-in pages with no
          TopBar, so they were also the only ones with no notification bell, no
          workspace switcher and no way to sign out — on `/notes` and `/chat`,
          where people spend the most time. The bar is a flex row above the
          content rather than hoisted into the layout because the height model
          genuinely differs here: these panes scroll internally against a
          definite height, so the content takes `flex-1 min-h-0` and the bar
          keeps its natural height. The mobile gap classes stay on this wrapper
          — they clear SideNav's phone bars, which is a separate concern. */}
      <div className="rail-offset kairos-topbar-gap kairos-bottomnav-gap flex h-[100dvh] flex-col overflow-hidden">
        <TopBar />
        <main
          id="main-content"
          className="kairos-page-enter min-h-0 flex-1 overflow-hidden"
        >
          <ChatShell userId={session.user.id} conversationId={numericId} />
        </main>
      </div>
    </div>
  );
}
