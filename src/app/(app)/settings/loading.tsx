import { Skeleton } from "~/components/ui/Skeleton";

/**
 * Stands in for the settings space, in its shape: it covers the app the same
 * way the real one does, so the rail does not flash through between the click
 * and the first paint.
 */
export default function SettingsLoading() {
  return (
    <div className="settings-elegant fixed inset-0 z-[55] flex bg-bg-primary">
      <aside className="hidden w-[300px] flex-none flex-col gap-8 border-r border-border-light bg-settings-side px-7 pt-[26px] lg:flex">
        <Skeleton className="h-[30px] w-40" />
        <div className="flex items-center gap-3.5">
          <Skeleton className="h-11 w-11" shape="circle" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </aside>
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 pt-24 sm:px-10 lg:px-14 lg:pt-28">
          <Skeleton className="h-12 w-56" />
          <Skeleton className="h-4 w-full max-w-[520px]" />
          <Skeleton className="mt-5 h-[70px] w-full" />
        </div>
      </div>
    </div>
  );
}
