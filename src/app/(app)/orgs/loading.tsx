export default function OrgsLoading() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-8 space-y-6">
        <div className="h-8 w-48 bg-bg-secondary rounded animate-pulse" />
        <div className="h-4 w-72 bg-bg-secondary rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 bg-bg-secondary rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
