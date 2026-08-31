import { redirect } from "next/navigation";
import { signInHref } from "~/lib/routes";

import { TopBar } from "~/components/layout/TopBar";
import { NewProjectDrawer } from "~/components/projects/NewProjectDrawer";
import { ProjectsWorkspace, isDetailTab } from "~/components/projects/ProjectsWorkspace";
import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect(signInHref("/projects"));
  }

  /* `?projectId=` deep-links straight into one project, so notifications and
     the dashboard can point at a project rather than at the list. */
  const params = await searchParams;
  const raw = params.projectId;
  const parsed = Number(Array.isArray(raw) ? raw[0] : raw);
  const initialProjectId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  /* `&tab=` picks which face of that project opens — the board, the team or
     the timeline — so a link can point at the timeline rather than at the
     project and a "go and look at the schedule" message can be one click. */
  const tabRaw = params.tab;
  const tabParam = Array.isArray(tabRaw) ? tabRaw[0] : tabRaw;
  const initialTab = isDetailTab(tabParam) ? tabParam : "tasks";

  /* `?new=1` opens the create drawer on arrival, so "new project" from the nav,
     the dashboard or a first-run workspace goes to the form directly. */
  const newRaw = params.new;
  const openNew = (Array.isArray(newRaw) ? newRaw[0] : newRaw) === "1";

  /* The list the workspace opens on. Fetched here rather than after hydration
     so the page arrives populated; the dashboard warms the same key, so moving
     between the two is served from cache either way. Not awaited — the result
     streams down through `HydrateClient` without holding up the shell. */
  void api.project.getMyProjects.prefetch();

  return (
    <HydrateClient>
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset kairos-page-enter flex min-h-dvh flex-col kairos-topbar-gap">
        {/* Creating a project is the page's one primary action, so it sits in the
            bar rather than competing with the heading below it. */}
        <TopBar actions={<NewProjectDrawer defaultOpen={openNew} />} />

        <main id="main-content" className="w-full flex-1 overflow-auto kairos-bottomnav-gap">
          <ProjectsWorkspace
            userId={session.user.id}
            initialProjectId={initialProjectId}
            initialTab={initialTab}
          />
        </main>
      </div>
    </div>
    </HydrateClient>
  );
}
