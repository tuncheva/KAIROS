import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";

import { DashboardClient } from "~/components/dashboard/DashboardClient";
import { SideNav } from "~/components/layout/SideNav";
import { UserDisplay } from "~/components/layout/UserDisplay";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import { WorkspaceIndicator } from "~/components/orgs/WorkspaceIndicator";
import { auth } from "~/server/auth";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const tNav = await getTranslations("nav");

  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />

      <div className="rail-offset min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
        <header className="sticky top-16 lg:top-0 z-30 topbar-solid">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 md:px-8 sm:py-4">
            <WorkspaceIndicator compact />

            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              <Link
                href="/create?action=new_project"
                className="flex items-center gap-2 rounded-lg bg-accent-primary px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                <Plus size={15} />
                <span className="hidden sm:inline">{tNav("newProject")}</span>
              </Link>
              <div className="hidden sm:block h-6 w-px bg-border-medium mx-1"></div>
              <NotificationSystem />
              <UserDisplay />
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
          <DashboardClient userName={session.user.name ?? null} />
        </main>
      </div>
    </div>
  );
}
