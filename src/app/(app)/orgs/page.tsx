import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { OrgDashboardClient } from "~/components/orgs/OrgDashboardClient";
import { TopBar } from "~/components/layout/TopBar";

export default async function OrgsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }


  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="rail-offset min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
        <TopBar />

        <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
          <div className="max-w-5xl mx-auto px-6 md:px-8 py-8">
            <OrgDashboardClient />
          </div>
        </main>
      </div>
    </div>
  );
}
