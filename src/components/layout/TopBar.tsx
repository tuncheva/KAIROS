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
  scrim = false,
}: {
  /** Page-specific controls, placed before the notification bell. */
  actions?: ReactNode;
  /**
   * A short fade under the bar, for pages whose content scrolls past it.
   *
   * The bar is opaque, so a row of settings sliding under it was sheared off
   * mid-glyph against the hairline. The scrim gives the last few pixels of that
   * row somewhere to go. It hangs off the bar rather than sitting in the page
   * because the bar is what is sticky — anything in the page would need to
   * re-derive the bar's height to know where to pin itself.
   */
  scrim?: boolean;
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

      {scrim ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-full h-5 bg-gradient-to-b from-bg-primary to-transparent"
        />
      ) : null}
    </header>
  );
}
