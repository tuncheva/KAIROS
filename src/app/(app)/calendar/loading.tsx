import { Skeleton, SkeletonTopBar } from "~/components/ui/Skeleton";

export default function CalendarLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset kairos-topbar-gap flex min-h-dvh flex-col">
        <header className="topbar-solid sticky top-16 z-30 lg:top-0">
          <SkeletonTopBar className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4 md:px-8" />
        </header>
        <main className="w-full flex-1 p-6">
          <div className="mx-auto max-w-7xl space-y-4">
            <Skeleton className="h-96" shape="lg" />
          </div>
        </main>
      </div>
    </div>
  );
}
