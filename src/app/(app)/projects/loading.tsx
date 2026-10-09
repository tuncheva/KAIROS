import { getTranslations } from "next-intl/server";

import { TopBar } from "~/components/layout/TopBar";
import { ProjectsSkeleton } from "~/components/projects/ProjectsSkeleton";
import { Plus } from "~/components/ui/icons";

/**
 * Mirrors `page.tsx`: the same shell and the real top bar, with the page's
 * primary action drawn inert until the drawer that owns it has loaded.
 */
export default async function ProjectsLoading() {
  const t = await getTranslations("projects.drawer");

  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset flex min-h-dvh flex-col kairos-topbar-gap">
        <TopBar
          actions={
            <span
              aria-hidden
              className="flex h-[34px] items-center gap-[7px] rounded-full bg-tui-accent px-3 text-[13px] font-medium whitespace-nowrap text-tui-on-accent opacity-45 sm:px-3.5"
            >
              <Plus size={15} aria-hidden />
              <span className="hidden sm:inline">{t("open")}</span>
            </span>
          }
        />

        <main className="w-full flex-1 overflow-auto kairos-bottomnav-gap">
          <ProjectsSkeleton />
        </main>
      </div>
    </div>
  );
}
