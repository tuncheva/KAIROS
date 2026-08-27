/**
 * The route skeleton, shaped like the workspace it precedes.
 *
 * It used to draw a card grid under a top bar — the layout the surface had
 * before this rebuild — so the page visibly rearranged itself the moment the
 * real thing mounted.
 */
export default function NotesLoading() {
  return (
    <div className="h-[100dvh] bg-bg-primary overflow-hidden">
      <div className="rail-offset h-[100dvh] flex kairos-topbar-gap" aria-hidden="true">
        {/* library rail */}
        <div className="hidden md:flex flex-col gap-2 w-[236px] flex-none p-4 bg-bg-surface border-r border-border-light/40">
          <div className="h-8 w-24 bg-bg-secondary rounded-lg animate-pulse" />
          <div className="h-10 w-full bg-bg-secondary rounded-xl animate-pulse mt-1" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 w-full bg-bg-secondary rounded-xl animate-pulse" />
          ))}
          <div className="h-3 w-16 bg-bg-secondary rounded animate-pulse mt-4" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 w-full bg-bg-secondary rounded-xl animate-pulse" />
          ))}
        </div>

        {/* note list */}
        <div className="w-full md:w-[318px] flex-none p-4 space-y-3 bg-bg-secondary md:border-r md:border-border-light/40">
          <div className="h-5 w-28 bg-bg-tertiary rounded animate-pulse" />
          <div className="flex gap-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-6 w-16 bg-bg-tertiary rounded-lg animate-pulse" />
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2 py-1">
              <div className="h-3 w-1/2 bg-bg-tertiary rounded animate-pulse" />
              <div className="h-2.5 w-4/5 bg-bg-tertiary rounded animate-pulse" />
              <div className="h-2 w-1/4 bg-bg-tertiary rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* page */}
        <div className="hidden md:block flex-1 p-10 space-y-4">
          <div className="h-8 w-2/5 bg-bg-secondary rounded animate-pulse" />
          <div className="h-3 w-1/4 bg-bg-secondary rounded animate-pulse" />
          <div className="space-y-2.5 pt-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-3 bg-bg-secondary rounded animate-pulse"
                style={{ width: `${90 - (i % 4) * 12}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
