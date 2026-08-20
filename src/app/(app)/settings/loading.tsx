export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="lg:ml-16 min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 bg-bg-primary/95 backdrop-blur-md border-b border-border-primary px-4 sm:px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-bg-secondary rounded-lg animate-pulse" />
              <div className="space-y-1">
                <div className="h-6 w-24 bg-bg-secondary rounded animate-pulse" />
                <div className="h-3 w-40 bg-bg-secondary rounded animate-pulse" />
              </div>
            </div>
            <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
          </div>
        </header>
        <div className="flex-1 flex overflow-hidden">
          <aside className="hidden md:block w-64 border-r border-border-primary p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 bg-bg-secondary rounded-lg animate-pulse" />
            ))}
          </aside>
          <main className="flex-1 p-6 space-y-6">
            <div className="h-8 w-48 bg-bg-secondary rounded animate-pulse" />
            <div className="space-y-4">
              <div className="h-12 bg-bg-secondary rounded-lg animate-pulse" />
              <div className="h-12 bg-bg-secondary rounded-lg animate-pulse" />
              <div className="h-12 bg-bg-secondary rounded-lg animate-pulse" />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
