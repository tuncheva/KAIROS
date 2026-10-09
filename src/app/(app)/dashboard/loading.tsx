import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { DashboardSkeleton } from "~/components/dashboard/DashboardSkeleton";
import { TopBar } from "~/components/layout/TopBar";
import { Plus } from "~/components/ui/icons.server";

/**
 * The dashboard route's fallback: the real top bar and page frame from
 * `page.tsx`, with `DashboardSkeleton` where `DashboardClient` will mount.
 */
export default async function DashboardLoading() {
  const tNav = await getTranslations("nav");

  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset min-h-dvh flex flex-col kairos-topbar-gap">
        <TopBar
          actions={
            <Link
              href="/projects?new=1"
              className="flex h-[34px] items-center gap-[7px] rounded-full bg-tui-accent px-3 text-[13px] font-medium whitespace-nowrap text-tui-on-accent transition-opacity hover:opacity-90 sm:px-3.5"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">{tNav("newProject")}</span>
            </Link>
          }
        />

        <main
          id="main-content"
          className="tui-screen flex-1 w-full overflow-auto kairos-bottomnav-gap"
          aria-busy="true"
        >
          <DashboardSkeleton />
        </main>
      </div>
    </div>
  );
}
