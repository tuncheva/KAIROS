import { Skeleton, SkeletonCards, SkeletonTopBar } from "~/components/ui/Skeleton";

export default function PublishLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset kairos-topbar-gap">
        <header className="sticky top-16 z-30 border-b border-border-light bg-bg-primary lg:top-0">
          <SkeletonTopBar className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4 lg:px-8" />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-12 sm:gap-8">
            <aside className="hidden space-y-4 lg:col-span-3 lg:block">
              <Skeleton className="h-48" shape="lg" />
            </aside>
            <div className="space-y-4 md:col-span-12 lg:col-span-6">
              <SkeletonCards count={3} className="h-56" />
            </div>
            <aside className="hidden space-y-4 lg:col-span-3 lg:block">
              <Skeleton className="h-32" shape="lg" />
              <Skeleton className="h-48" shape="lg" />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
