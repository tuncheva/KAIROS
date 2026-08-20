import { auth } from "~/server/auth";
import { redirect } from "next/navigation";

import { SideNav } from "~/components/layout/SideNav";
import { ChatClient } from "~/components/chat/ChatClient";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  return (
    <div className="h-[100dvh] bg-bg-primary overflow-hidden">
      <SideNav />

      <main id="main-content" className="lg:ml-16 h-[100dvh] overflow-hidden kairos-page-enter pt-16 lg:pt-0 pb-24 lg:pb-0">
        <ChatClient userId={session.user.id} />
      </main>
    </div>
  );
}
