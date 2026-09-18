import { Skeleton, SkeletonCards, SkeletonTopBar } from "~/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset kairos-topbar-gap flex min-h-dvh flex-col">
        <header className="topbar-solid sticky top-16 z-30 lg:top-0">
          <SkeletonTopBar
            className="px-4 py-3 sm:px-6 sm:py-4 md:px-8"
            titleClassName="h-7 w-40"
          />
        </header>

        <main className="grid flex-1 grid-cols-1 items-start xl:grid-cols-[minmax(0,1fr)_372px]">
          <div className="flex flex-col gap-9 px-4 pt-8 pb-14 sm:px-8">
            <div className="space-y-3">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
            <Skeleton className="h-20" shape="md" />
            <div className="space-y-2">
              <SkeletonCards count={4} className="h-14" />
            </div>
            <Skeleton className="h-28" shape="md" />
          </div>
          <div className="flex flex-col gap-8 px-4 pt-8 pb-14 sm:px-8 xl:px-7">
            <Skeleton className="h-40" shape="md" />
            <Skeleton className="h-56" shape="md" />
            <Skeleton className="h-32" shape="md" />
          </div>
        </main>
      </div>
    </div>
  );
}
