import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import { SideNav } from "~/components/layout/SideNav";
import { TopBar } from "~/components/layout/TopBar";
import { OnboardingGate } from "~/components/auth/OnboardingGate";
import { NotesDashboard } from "~/components/notes/NotesDashboard";

export default async function NotesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <OnboardingGate>
      <div className="min-h-screen bg-bg-primary">
        <SideNav />
        <div className="rail-offset min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
          <TopBar />
          <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
            <NotesDashboard />
          </main>
        </div>
      </div>
    </OnboardingGate>
  );
}
