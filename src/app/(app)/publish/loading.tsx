import { PublishLoadingView } from "~/components/publish/PublishSkeleton";

/**
 * The events feed while the route's code arrives: the same shell
 * `PublishPage` draws, with the rail, composer and toolbar real and the
 * events themselves hatched.
 */
export default function PublishLoading() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset kairos-topbar-gap">
        <PublishLoadingView />
      </div>
    </div>
  );
}
