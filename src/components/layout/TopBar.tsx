import type { ReactNode } from "react";

import { UserDisplay } from "~/components/layout/UserDisplay";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import { WorkspaceMenu } from "~/components/orgs/WorkspaceMenu";

/**
 * The one topbar.
 *
 * Every page used to hand-roll this row, which is how the same bar ended up
 * with the workspace on the left on one page and the right on another. The
 * order is now fixed — where you are, then what this page is, then actions,
 * then you — and pages only supply the middle and the actions.
 */
export function TopBar({
  title,
  breadcrumb,
  actions,
}: {
  /** The page's own heading, sitting after the workspace identity. */
  title?: ReactNode;
  /** Optional trail rendered above the title. */
  breadcrumb?: ReactNode;
  /** Page-specific controls, placed before the notification bell. */
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-16 z-30 border-b border-border-light/50 topbar-solid lg:top-0">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <WorkspaceMenu />

          {title ? (
            <>
              <span
                aria-hidden="true"
                className="hidden h-7 w-px shrink-0 bg-border-light/70 md:block"
              />
              <div className="hidden min-w-0 md:block">
                {breadcrumb ? (
                  <div className="truncate text-[11px] leading-tight text-fg-tertiary">
                    {breadcrumb}
                  </div>
                ) : null}
                <h1 className="truncate font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-fg-primary">
                  {title}
                </h1>
              </div>
            </>
          ) : null}
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
