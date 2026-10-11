import { TopBar } from "~/components/layout/TopBar";
import { CalendarSkeleton } from "~/components/calendar/CalendarSkeleton";

/* Same shell as `page.tsx`, and the same skeleton CalendarClient holds until
   the browser clock is known — so route loading, hydration and the first
   client render all show one continuous frame. */
export default function CalendarLoading() {
  return (
    <div className="calendar-refined tui-screen h-dvh overflow-hidden">
      <div className="rail-offset h-dvh flex flex-col kairos-topbar-gap">
        <TopBar />
        <main className="flex-1 min-h-0 w-full overflow-auto kairos-bottomnav-gap">
          <CalendarSkeleton />
        </main>
      </div>
    </div>
  );
}
