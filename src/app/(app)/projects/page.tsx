import { ProjectsListWorkspace } from "~/components/projects/ProjectsListClient";
import { SideNav } from "~/components/layout/SideNav";
import { TopBar } from "~/components/layout/TopBar";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }


  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />
      <div className="rail-offset min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
        <TopBar />

        <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
          <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 pt-4">
            <ProjectsListWorkspace userId={session.user.id} />
          </div>
        </main>
      </div>
    </div>
  );
}
