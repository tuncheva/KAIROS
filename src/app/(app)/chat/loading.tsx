import { TopBar } from "~/components/layout/TopBar";
import { ChatShellSkeleton } from "~/components/chat/ChatSkeletons";

export default function ChatLoading() {
  /* The same wrappers as the page itself (rail offset, top-bar gap, the
     definite height the panes scroll against), so nothing jumps on arrival. */
  return (
    <div className="bg-bg-primary h-[100dvh] overflow-hidden">
      <div className="rail-offset kairos-topbar-gap kairos-bottomnav-gap flex h-[100dvh] flex-col overflow-hidden">
        <TopBar />
        <main id="main-content" className="min-h-0 flex-1 overflow-hidden">
          <ChatShellSkeleton threadOpen={false} />
        </main>
      </div>
    </div>
  );
}
