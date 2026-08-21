import type { ReactNode } from "react";

import { UserDisplay } from "~/components/layout/UserDisplay";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import { WorkspaceMenu } from "~/components/orgs/WorkspaceMenu";

/**
 * The one topbar.
 *
 * Every page used to hand-roll this row, which is how the same bar ended up
 * with the workspace on the left on one page and the right on another. The
 * order is now fixed — where you are, then actions, then you.
 *
 * It deliberately does not restate the page name. Every page already opens with
 * its own heading, so the bar was rendering a second `h1` that said the same
 * thing in a display face nobody asked for.
 */
export function TopBar({
  actions,
}: {
  /** Page-specific controls, placed before the notification bell. */
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-16 z-30 border-b border-border-light/50 topbar-solid lg:top-0">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <WorkspaceMenu />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {actions}
          {actions ? (
            <span
              aria-hidden="true"
              className="mx-1 hidden h-6 w-px bg-border-light/70 sm:block"
            />
          ) : null}
          <NotificationSystem />
          <UserDisplay />
        </div>
      </div>
    </header>
  );
}
