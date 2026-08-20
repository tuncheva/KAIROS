import Link from "next/link";
import { auth } from "~/server/auth";
import { UserDisplay } from "~/components/layout/UserDisplay";
import { SideNav } from "~/components/layout/SideNav";
import { CreateNoteForm } from "~/components/notes/CreateNoteForm";
import { CreateProjectContainer } from "~/components/projects/CreateProjectContainer";
import { NotesList } from "~/components/notes/NotesList";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import { WorkspaceIndicator } from "~/components/orgs/WorkspaceIndicator";
import { OnboardingGate } from "~/components/auth/OnboardingGate";
import { TaskTimelineClient } from "~/components/progress/TaskTimelineClient";
import { LogIn, ArrowRight, FolderKanban, StickyNote } from "lucide-react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

export default async function CreatePage({ 
    searchParams 
}: { 
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth();
  const tCreate = await getTranslations("create");
  const tAuth = await getTranslations("auth");
  const tNav = await getTranslations("nav");
  const resolvedSearchParams = await searchParams;
  const action = resolvedSearchParams.action as string | undefined;
  
  const shouldShowNoteForm = action === 'new_note';
  const shouldShowProjectManagement = action === 'new_project';
  
  // If the user is not logged in
  if (!session?.user) {
    return (
      <main id="main-content" className="flex min-h-screen flex-col items-center justify-center bg-bg-primary">
        <div className="absolute top-8 right-8 z-10">
          <UserDisplay />
        </div>
        
        <div className="container flex flex-col items-center justify-center gap-8 px-4 py-16 max-w-md text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-accent-primary to-accent-secondary rounded-2xl flex items-center justify-center shadow-lg shadow-accent-primary/25">
            <LogIn className="text-white" size={40} />
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-bold text-fg-primary">
            {tAuth("signIn")}
          </h1>
          
          <p className="text-lg text-fg-secondary">
            {tCreate("subtitle")}
          </p>
          
          <Link
            href="/api/auth/signin"
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-accent-primary to-accent-secondary text-white font-semibold rounded-xl hover:shadow-2xl hover:shadow-accent-primary/25 transition-transform transition-shadow hover:scale-[1.02] group"
          >
            <LogIn size={20} />
            {tAuth("signIn")}
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <OnboardingGate>
    <div className="min-h-screen bg-bg-primary relative timeline-page">
      <SideNav />

      <div className="lg:ml-16 min-h-screen flex flex-col pt-16 lg:pt-0 relative z-10 kairos-page-enter">
        <header className="sticky top-16 lg:top-0 z-30 topbar-solid shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-3 sm:py-4 flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={
                    "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm " +
                    (shouldShowProjectManagement
                      ? "bg-accent-primary"
                      : shouldShowNoteForm
                        ? "bg-warning"
                        : "bg-gradient-to-br from-accent-primary to-accent-secondary")
                  }
                >
                  {shouldShowProjectManagement ? (
                    <FolderKanban className="text-white" size={22} />
                  ) : shouldShowNoteForm ? (
                    <StickyNote className="text-white" size={22} />
                  ) : (
                    <Image src="/workspace.png" alt="Workspace" width={28} height={28} className="invert dark:invert-0" />
                  )}
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-fg-primary tracking-[-0.02em] font-display">
                    {shouldShowProjectManagement
                      ? tNav("projects")
                      : shouldShowNoteForm
                        ? tNav("notes")
                        : tCreate("title")}
                  </h1>
                </div>
              </div>
              
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
              <WorkspaceIndicator compact />
              <div className="hidden sm:block h-6 w-px bg-border-medium mx-2"></div>
              <NotificationSystem />
              <UserDisplay />
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 w-full px-4 sm:px-6 md:px-8 py-5 sm:py-6 overflow-auto relative pb-24 lg:pb-6">
          <div className="max-w-7xl mx-auto w-full space-y-4">
            {shouldShowProjectManagement ? (
              <div className="relative w-full h-full mt-4">
                <CreateProjectContainer userId={session.user.id} />
              </div>
            ) : shouldShowNoteForm ? (
              <div className="flex flex-col lg:flex-row gap-4 w-full h-[calc(100vh-200px)] mt-4">
                <div className="w-full lg:w-[400px] lg:flex-shrink-0 flex flex-col p-5 rounded-xl bg-bg-elevated shadow-xl shadow-accent-primary/10">
                  <CreateNoteForm />
                </div>
                <div className="flex-1 p-5 overflow-hidden rounded-xl bg-bg-elevated shadow-xl shadow-accent-primary/10">
                  <NotesList />
                </div>
              </div>
            ) : (
              <TaskTimelineClient />
            )}
          </div>
        </main>
      </div>
    </div>
    </OnboardingGate>
  );
}
