import type { ReactNode } from "react";

import { UserDisplay } from "~/components/layout/UserDisplay";
import { SearchTrigger } from "~/components/layout/SearchTrigger";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import { WorkspaceMenu } from "~/components/orgs/WorkspaceMenu";

/**
 * The one topbar.
 *
 * Every page used to hand-roll this row, which is how the same bar ended up
 * with the workspace on the left on one page and the right on another. The
 * order is now fixed — where you are, then actions, then you.
 *
 * It wears the refined `tui-*` palette (warm pane, ink hairline, violet
 * accent, pill controls) on every page, not just the reskinned ones, so it is
 * the same bar wherever you are.
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
    /* Pinned under the phone's fixed bar, whose height grows by the notch
       inset — a flat `top-16` slid this bar's top edge under it on every
       phone with a safe area. */
    <header className="sticky top-[calc(var(--kairos-topbar-h)+var(--kairos-safe-top))] z-30 border-b border-tui-ink/8 bg-tui-pane lg:top-0">
      <div className="flex h-[52px] items-center gap-2 pr-2.5 pl-2 sm:h-14 sm:gap-4 sm:pr-5 sm:pl-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <WorkspaceMenu />
          <span
            aria-hidden="true"
            className="mx-1.5 hidden h-5 w-px shrink-0 bg-tui-ink/12 sm:block"
          />
          {/* The palette's door. It had none — ⌘K was the only way in, and
              nothing in the interface said so. */}
          <SearchTrigger />
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          {actions}
          {actions ? (
            <span
              aria-hidden="true"
              className="mx-1.5 hidden h-5 w-px bg-tui-ink/12 sm:block"
            />
          ) : null}
          <NotificationSystem />
          <UserDisplay />
        </div>
      </div>

      {scrim ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-full h-5 bg-gradient-to-b from-tui-pane to-transparent"
        />
      ) : null}
    </header>
  );
}
