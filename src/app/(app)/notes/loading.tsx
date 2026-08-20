export default function NotesLoading() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="lg:ml-16 min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 bg-bg-primary/80 backdrop-blur-md border-b border-border-primary px-4 sm:px-8 py-3">
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <div className="h-4 w-32 bg-bg-secondary rounded animate-pulse" />
              <div className="h-7 w-20 bg-bg-secondary rounded animate-pulse" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
              <div className="h-8 w-8 bg-bg-secondary rounded-full animate-pulse" />
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 bg-bg-secondary rounded-xl animate-pulse" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
