import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SideNav } from "~/components/layout/SideNav";
import { TopBar } from "~/components/layout/TopBar";
import { ProgressFeedClient } from "~/components/progress/ProgressFeedClient";

export default async function ProgressPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const tNav = await getTranslations("nav");

  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />

      <div className="rail-offset min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
        <TopBar title={tNav("progress")} />

        <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
          <ProgressFeedClient />
        </main>
      </div>
    </div>
  );
}
