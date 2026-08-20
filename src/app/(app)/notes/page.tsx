import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import { SideNav } from "~/components/layout/SideNav";
import { UserDisplay } from "~/components/layout/UserDisplay";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import { WorkspaceIndicator } from "~/components/orgs/WorkspaceIndicator";
import { OnboardingGate } from "~/components/auth/OnboardingGate";
import { NotesDashboard } from "~/components/notes/NotesDashboard";
import { getTranslations } from "next-intl/server";

export default async function NotesPage() {
  const session = await auth();
  const tNav = await getTranslations("nav");

  if (!session?.user) {
    redirect("/");
  }

  return (
    <OnboardingGate>
      <div className="min-h-screen bg-bg-primary">
        <SideNav />
        <div className="lg:ml-16 min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
          <header className="sticky top-16 lg:top-0 z-30 topbar-solid">
            <div className="px-4 sm:px-8 py-3 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2 text-fg-tertiary text-xs mb-0.5">
                    <span>{tNav("projects")}</span>
                    <span className="text-[10px]">›</span>
                    <span className="text-fg-secondary font-medium">{tNav("notes")}</span>
                  </div>
                  <h1 className="text-2xl font-bold text-fg-primary tracking-tight">{tNav("notes")}</h1>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <WorkspaceIndicator compact />
                <div className="hidden sm:block h-6 w-px bg-slate-200 dark:bg-white/[0.06]" />
                <NotificationSystem />
                <UserDisplay />
              </div>
            </div>
          </header>
          <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
            <NotesDashboard />
          </main>
        </div>
      </div>
    </OnboardingGate>
  );
}
