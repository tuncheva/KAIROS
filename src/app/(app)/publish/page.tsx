import { Suspense } from "react";

import { SideNav } from "~/components/layout/SideNav";
import { PublishWorkspace } from "~/components/publish/PublishWorkspace";

/**
 * The events feed.
 *
 * No `auth()` call here, as before: the cookie gate in `src/proxy.ts` already
 * keeps signed-out visitors off `/publish`, and the panes below stay defensive
 * anyway — `getPublicEvents` is a public procedure and the cards ask you to
 * sign in at the moment you try to like, RSVP or comment.
 *
 * The shell is all this page owns. The rail, feed and aside, and the state that
 * decides what is in them, live in `PublishWorkspace`.
 */
export default function PublishPage() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />

      <div className="rail-offset kairos-page-enter pt-16 lg:pt-0">
        {/* The workspace reads the view and region from the query string. */}
        <Suspense fallback={null}>
          <PublishWorkspace />
        </Suspense>
      </div>
    </div>
  );
}
