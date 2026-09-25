import { Skeleton, SkeletonCards } from "~/components/ui/Skeleton";

export default function OrgsLoading() {
  return (
    /* The top-bar gap, as on `/orgs` itself — without it the skeleton's
       heading started under the phone's fixed bar. */
    <div className="kairos-topbar-gap min-h-dvh bg-bg-primary">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 md:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <SkeletonCards count={4} className="h-48" />
        </div>
      </div>
    </div>
  );
}
