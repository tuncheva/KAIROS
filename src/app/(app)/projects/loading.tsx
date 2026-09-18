import { SkeletonCards, SkeletonTopBar } from "~/components/ui/Skeleton";

export default function ProjectsLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset kairos-topbar-gap flex min-h-dvh flex-col">
        <header className="topbar-solid sticky top-16 z-30 lg:top-0">
          <SkeletonTopBar
            className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4 md:px-8"
            titleClassName="h-7 w-28"
          />
        </header>
        <main className="flex-1 px-4 pt-4 sm:px-6">
          <div className="mx-auto max-w-6xl space-y-4">
            <SkeletonCards count={4} className="h-32" />
          </div>
        </main>
      </div>
    </div>
  );
}
