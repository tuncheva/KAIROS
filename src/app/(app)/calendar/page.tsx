import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { SideNav } from "~/components/layout/SideNav";
import { TopBar } from "~/components/layout/TopBar";
import { CalendarClient } from "~/components/calendar/CalendarClient";

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }


  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />

      <div className="rail-offset min-h-screen flex flex-col pt-16 lg:pt-0 kairos-page-enter">
        <TopBar />

        <main id="main-content" className="flex-1 w-full overflow-auto pb-24 lg:pb-0">
          <CalendarClient />
        </main>
      </div>
    </div>
  );
}
