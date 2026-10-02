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
              className="bg-tui-accent text-tui-on-accent flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold opacity-45"
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
