import { Skeleton } from "~/components/ui/Skeleton";

export default function KairosAILoading() {
  return (
    <div className="h-[100dvh] overflow-hidden bg-bg-primary">
      <div className="rail-offset flex h-[100dvh] flex-col overflow-hidden">
        <div className="flex flex-1 flex-col gap-4 p-4">
          <Skeleton className="h-8 w-48" />
          <div className="flex-1 space-y-4">
            <Skeleton className="h-12 w-3/4" shape="lg" />
            <Skeleton className="ml-auto h-12 w-1/2" shape="lg" />
            <Skeleton className="h-12 w-2/3" shape="lg" />
          </div>
          <Skeleton className="h-12" shape="md" />
        </div>
      </div>
    </div>
  );
}
