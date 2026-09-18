import { Skeleton, SkeletonCards } from "~/components/ui/Skeleton";

export default function OrgsLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 md:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <SkeletonCards count={4} className="h-48" />
        </div>
      </div>
    </div>
  );
}
