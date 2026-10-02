import { redirect } from "next/navigation";
import { signInHref } from "~/lib/routes";
import { auth } from "~/server/auth";
import { TeamClient } from "~/components/orgs/team/TeamClient";
import { TopBar } from "~/components/layout/TopBar";

export default async function OrgsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect(signInHref("/orgs"));
  }

  /* The Team page's panes scroll internally against a definite height on wide
     screens, the way `/chat` does; on phones they stack and the page scrolls. */
  return (
    <div className="min-h-dvh bg-bg-primary lg:h-[100dvh] lg:overflow-hidden">
      <div className="rail-offset kairos-topbar-gap kairos-bottomnav-gap flex min-h-dvh flex-col lg:h-[100dvh] lg:overflow-hidden">
        <TopBar />

        <main id="main-content" className="kairos-page-enter flex w-full flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
          <TeamClient />
        </main>
      </div>
    </div>
  );
}
