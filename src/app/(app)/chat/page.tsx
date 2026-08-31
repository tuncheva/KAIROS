import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";

import { ChatShell } from "~/components/chat/ChatShell";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) {
    redirect(signInHref("/chat"));
  }

  return (
    <div className="h-[100dvh] bg-bg-primary overflow-hidden">
      <main
        id="main-content"
        className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter kairos-topbar-gap kairos-bottomnav-gap"
      >
        <ChatShell userId={session.user.id} conversationId={null} />
      </main>
    </div>
  );
}
