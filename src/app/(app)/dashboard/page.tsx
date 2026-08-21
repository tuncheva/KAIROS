import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";

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
          title={tNav("dashboard")}
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
        </main>
      </div>
    </div>
  );
}
