export default function ProgressLoading() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="lg:ml-16 min-h-screen flex flex-col pt-16 lg:pt-0">
        <header className="sticky top-16 lg:top-0 z-30 topbar-solid">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-3 sm:py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="h-7 w-28 bg-bg-secondary rounded animate-pulse" />
              <div className="h-8 w-32 bg-bg-secondary rounded-lg animate-pulse" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
            </div>
          </div>
        </header>
        <main className="flex-1 w-full overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 bg-bg-secondary rounded-xl animate-pulse" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
