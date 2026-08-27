import { auth } from "~/server/auth";
import { redirect } from "next/navigation";

import { AIChatPageClient } from "~/components/chat/AIChatPageClient";

export default async function KairosAIPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  return (
    <div className="h-[100dvh] bg-bg-primary overflow-hidden">
      <main id="main-content" className="rail-offset h-[100dvh] overflow-hidden kairos-page-enter kairos-topbar-gap kairos-bottomnav-gap">
        <AIChatPageClient />
      </main>
    </div>
  );
}
