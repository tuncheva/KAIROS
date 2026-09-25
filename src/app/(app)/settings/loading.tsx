import { Skeleton, SkeletonCards } from "~/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      {/* The same gap and pin as the page it stands in for; without them the
          placeholder header drew under the phone's fixed top bar. */}
      <div className="rail-offset kairos-topbar-gap flex min-h-dvh flex-col">
        <header className="sticky top-[calc(var(--kairos-topbar-h)+var(--kairos-safe-top))] z-30 border-b border-border-light bg-bg-primary/95 px-4 py-4 backdrop-blur-md sm:px-6 lg:top-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8" shape="md" />
              <div className="space-y-1">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <Skeleton className="h-8 w-8" shape="circle" />
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <aside className="hidden w-64 space-y-2 border-r border-border-light p-4 md:block">
            <SkeletonCards count={6} className="h-control-md" />
          </aside>
          <main className="flex-1 space-y-6 p-6">
            <Skeleton className="h-8 w-48" />
            <div className="space-y-4">
              <SkeletonCards count={3} className="h-12" />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
