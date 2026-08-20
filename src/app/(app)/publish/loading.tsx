export default function PublishLoading() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="lg:ml-16 pt-16 lg:pt-0">
        <header className="sticky top-16 lg:top-0 z-30 bg-bg-primary border-b border-border-primary">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex justify-between items-center">
            <div className="h-7 w-32 bg-bg-secondary rounded animate-pulse" />
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8">
            <aside className="hidden lg:block lg:col-span-3 space-y-4">
              <div className="h-48 bg-bg-secondary rounded-xl animate-pulse" />
            </aside>
            <div className="md:col-span-12 lg:col-span-6 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-56 bg-bg-secondary rounded-xl animate-pulse" />
              ))}
            </div>
            <aside className="hidden lg:block lg:col-span-3 space-y-4">
              <div className="h-32 bg-bg-secondary rounded-xl animate-pulse" />
              <div className="h-48 bg-bg-secondary rounded-xl animate-pulse" />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
