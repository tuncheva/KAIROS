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
     screens, the way `/chat` does. Below `xl` the person pane drops to its own
     row, so the page has to scroll or that row is clipped away. */
  return (
    <div className="min-h-dvh bg-bg-primary xl:h-[100dvh] xl:overflow-hidden">
      <div className="rail-offset kairos-topbar-gap kairos-bottomnav-gap flex min-h-dvh flex-col xl:h-[100dvh] xl:overflow-hidden">
        <TopBar />

        <main id="main-content" className="kairos-page-enter flex w-full flex-1 flex-col xl:min-h-0 xl:overflow-hidden">
          <TeamClient />
        </main>
      </div>
    </div>
  );
}
