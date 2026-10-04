import { TopBar } from "~/components/layout/TopBar";
import { TeamSkeleton } from "~/components/orgs/team/TeamSkeleton";

export default function OrgsLoading() {
  /* The same wrappers as `/orgs` itself (top-bar gap, rail offset, the
     definite height on wide screens) and the same three panes as
     `TeamClient`, so nothing jumps when the page lands. */
  return (
    <div className="min-h-dvh bg-bg-primary lg:h-[100dvh] lg:overflow-hidden">
      <div className="rail-offset kairos-topbar-gap kairos-bottomnav-gap flex min-h-dvh flex-col lg:h-[100dvh] lg:overflow-hidden">
        <TopBar />

        <main id="main-content" className="flex w-full flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
          <TeamSkeleton />
        </main>
      </div>
    </div>
  );
}
