import { Skeleton, SkeletonCards, SkeletonTopBar } from "~/components/ui/Skeleton";

export default function ProgressLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset kairos-topbar-gap flex min-h-dvh flex-col">
        <header className="topbar-solid sticky top-[calc(var(--kairos-topbar-h)+var(--kairos-safe-top))] z-30 lg:top-0">
          <SkeletonTopBar
            className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4 md:px-8"
            titleClassName="h-7 w-28"
          >
            <Skeleton className="h-8 w-32" shape="md" />
          </SkeletonTopBar>
        </header>
        <main className="w-full flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-7xl space-y-4">
            <SkeletonCards count={5} className="h-24" />
          </div>
        </main>
      </div>
    </div>
  );
}
