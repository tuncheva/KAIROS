import { auth } from "~/server/auth";
import { TopBar } from "~/components/layout/TopBar";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";

import { AIChatPageClient } from "~/components/chat/AIChatPageClient";

export default async function KairosAIPage() {
  const session = await auth();
  if (!session?.user) {
    redirect(signInHref("/chat/ai"));
  }

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
          <AIChatPageClient />
        </main>
      </div>
    </div>
  );
}
