import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";

import { AiInsightsPanel } from "~/components/dashboard/AiInsightsPanel";
import { DashboardClient } from "~/components/dashboard/DashboardClient";
import { SideNav } from "~/components/layout/SideNav";
import { TopBar } from "~/components/layout/TopBar";
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
        <TopBar
          actions={
            <Link
              href="/create?action=new_project"
              className="flex items-center gap-2 rounded-lg bg-accent-primary px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">{tNav("newProject")}</span>
            </Link>
          }
        />

        <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
          <DashboardClient userName={session.user.name ?? null} />

          {/*
            B-2/B-3. Below the dashboard rather than above it: what the radar
            found is worth seeing, but it is not more important than the work the
            user came here to look at, and an alarm panel above the fold is how a
            dashboard starts feeling like a complaint.
          */}
          <div className="px-4 pb-8 sm:px-6 lg:px-8">
            <AiInsightsPanel />
          </div>
        </main>
      </div>
    </div>
  );
}
