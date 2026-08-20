import { ProjectsListWorkspace } from "~/components/projects/ProjectsListClient";
import { SideNav } from "~/components/layout/SideNav";
import { UserDisplay } from "~/components/layout/UserDisplay";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import { WorkspaceIndicator } from "~/components/orgs/WorkspaceIndicator";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const tNav = await getTranslations("nav");

  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />
      <div className="lg:ml-16 min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
        <header className="sticky top-16 lg:top-0 z-30 topbar-solid">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-3 sm:py-4 flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-fg-primary tracking-tight">{tNav("projects")}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
              <WorkspaceIndicator compact />
              <div className="hidden sm:block h-6 w-px bg-border-medium mx-1"></div>
              <NotificationSystem />
              <UserDisplay />
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
          <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 pt-4">
            <ProjectsListWorkspace userId={session.user.id} />
          </div>
        </main>
      </div>
    </div>
  );
}
