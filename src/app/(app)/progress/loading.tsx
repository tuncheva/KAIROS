import { TopBar } from "~/components/layout/TopBar";
import { ProgressSkeleton } from "~/components/progress/ProgressSkeleton";

/* Same shell as `page.tsx`, and the same skeleton ProgressClient holds until
   the browser clock and the record are in — one continuous frame from route
   loading to data. */
export default function ProgressLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset min-h-dvh flex flex-col kairos-topbar-gap">
        <TopBar />
        <main className="flex-1 w-full overflow-auto kairos-bottomnav-gap">
          <ProgressSkeleton />
        </main>
      </div>
    </div>
  );
}
