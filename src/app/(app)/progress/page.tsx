import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";

import { TopBar } from "~/components/layout/TopBar";
import { ProgressClient } from "~/components/progress/ProgressClient";

export default async function ProgressPage() {
  const session = await auth();
  if (!session?.user) {
    redirect(signInHref("/progress"));
  }


  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset min-h-dvh flex flex-col kairos-topbar-gap kairos-page-enter">
        <TopBar />

        <main id="main-content" className="flex-1 w-full overflow-auto kairos-bottomnav-gap">
          <ProgressClient />
        </main>
      </div>
    </div>
  );
}
