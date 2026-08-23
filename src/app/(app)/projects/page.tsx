import { redirect } from "next/navigation";

import { SideNav } from "~/components/layout/SideNav";
import { TopBar } from "~/components/layout/TopBar";
import { NewProjectDrawer } from "~/components/projects/NewProjectDrawer";
import { ProjectsWorkspace } from "~/components/projects/ProjectsWorkspace";
import { auth } from "~/server/auth";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />
      <div className="rail-offset kairos-page-enter flex min-h-screen flex-col pt-16 lg:pt-0">
        {/* Creating a project is the page's one primary action, so it sits in the
            bar rather than competing with the heading below it. */}
        <TopBar actions={<NewProjectDrawer />} />

        <main id="main-content" className="w-full flex-1 overflow-auto pb-24 lg:pb-0">
          <ProjectsWorkspace userId={session.user.id} />
        </main>
      </div>
    </div>
  );
}
