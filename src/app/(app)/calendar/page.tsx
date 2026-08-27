import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { TopBar } from "~/components/layout/TopBar";
import { CalendarClient } from "~/components/calendar/CalendarClient";

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }


  return (
    <div className="h-dvh overflow-hidden bg-bg-primary">
      {/* The calendar is a fixed-height surface that scrolls its own hour grid,
          so this column needs a DEFINITE height: with `min-h-screen` the height
          stays indefinite, `flex-1` on <main> falls back to content sizing and
          `h-full` inside it resolves to `auto` — the grid then grows past the
          fold and the drawer's actions end up off-screen. */}
      <div className="rail-offset h-dvh flex flex-col pt-16 lg:pt-0 kairos-page-enter">
        <TopBar />

        <main
          id="main-content"
          className="flex-1 min-h-0 w-full overflow-auto pb-24 lg:pb-0"
        >
          <CalendarClient />
        </main>
      </div>
    </div>
  );
}
