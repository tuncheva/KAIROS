export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="lg:ml-16 min-h-screen flex flex-col pt-16 lg:pt-0">
        <header className="sticky top-16 lg:top-0 z-30 topbar-solid">
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 md:px-8 sm:py-4">
            <div className="h-7 w-40 bg-bg-secondary rounded animate-pulse" />
            <div className="flex items-center gap-3">
              <div className="h-9 w-28 bg-bg-secondary rounded-lg animate-pulse" />
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
            </div>
          </div>
        </header>

        <main className="grid flex-1 grid-cols-1 items-start xl:grid-cols-[minmax(0,1fr)_372px]">
          <div className="flex flex-col gap-9 px-4 pt-8 pb-14 sm:px-8">
            <div className="space-y-3">
              <div className="h-3 w-40 bg-bg-secondary rounded animate-pulse" />
              <div className="h-10 w-72 bg-bg-secondary rounded animate-pulse" />
              <div className="h-4 w-96 max-w-full bg-bg-secondary rounded animate-pulse" />
            </div>
            <div className="h-20 bg-bg-secondary rounded-[10px] animate-pulse" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 bg-bg-secondary rounded animate-pulse" />
              ))}
            </div>
            <div className="h-28 bg-bg-secondary rounded-[10px] animate-pulse" />
          </div>
          <div className="flex flex-col gap-8 px-4 pt-8 pb-14 sm:px-8 xl:px-7">
            <div className="h-40 bg-bg-secondary rounded-[10px] animate-pulse" />
            <div className="h-56 bg-bg-secondary rounded-[10px] animate-pulse" />
            <div className="h-32 bg-bg-secondary rounded-[10px] animate-pulse" />
          </div>
        </main>
      </div>
    </div>
  );
}
