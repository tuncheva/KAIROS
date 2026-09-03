import { redirect } from "next/navigation";
import { signInHref } from "~/lib/routes";
import { auth } from "~/server/auth";
import { OrgDashboardClient } from "~/components/orgs/OrgDashboardClient";
import { TopBar } from "~/components/layout/TopBar";

export default async function OrgsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect(signInHref("/orgs"));
  }


  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset min-h-dvh flex flex-col kairos-topbar-gap kairos-page-enter">
        <TopBar />

        <main id="main-content" className="flex-1 w-full overflow-auto kairos-bottomnav-gap">
          <div className="max-w-5xl mx-auto px-6 md:px-8 py-8">
            <OrgDashboardClient />
          </div>
        </main>
      </div>
    </div>
  );
}
