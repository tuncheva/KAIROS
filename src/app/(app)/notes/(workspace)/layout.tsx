import { auth } from "~/server/auth";
import { TopBar } from "~/components/layout/TopBar";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";

import { NotesWorkspace } from "~/components/notes/NotesWorkspace";

/**
 * The notes surface, mounted once for the whole surface.
 *
 * ## Why this file exists
 *
 * Selection is a route — `/notes`, `/notes/new`, `/notes/[noteId]` — and the
 * workspace used to be rendered by each of those three pages, from three
 * byte-identical copies of this shell. A route group without a layout gives its
 * pages no shared boundary, so the workspace sat *inside* the page segment and
 * every note you opened was a page load: a server round trip that awaited
 * `auth()` before anything could render, `.kairos-page-enter` replaying its
 * fade over the whole surface, and — while `loading.tsx` still existed — the
 * three panes being replaced by a skeleton and rebuilt. Tapping a row in a list
 * felt like navigating to a different site.
 *
 * This is the same fix `(app)/layout.tsx` documents for `SideNav`, for the same
 * reason: hoisting the component to be a sibling of `children` in the segment
 * tree is what lets React keep the exact same DOM across a navigation. The
 * workspace now mounts once per visit to the surface and simply re-reads which
 * note is selected.
 *
 * Two consequences worth naming:
 *
 * - The in-memory unlock map survives switching notes. It is component state,
 *   so a remount used to empty it — unlocking a note, opening another and
 *   coming back made you retype the password for a note you had already opened.
 * - `auth()` runs once here instead of once per note.
 *
 * ## Why a route group
 *
 * `/notes/[noteId]/recover` is a child of `/notes` and must *not* be wrapped in
 * this shell — it is a standalone recovery form, not the workspace. A layout at
 * `notes/` would wrap it too, and a server layout cannot read the pathname to
 * opt out. `(workspace)` scopes the layout to the three routes that are the
 * workspace and leaves `recover` outside it. The group name is stripped from
 * the URL, so every path is unchanged.
 *
 * ## Why the pages below are empty
 *
 * They exist to define the URLs and to reject bad ones. The workspace reads the
 * selected note from `usePathname()` rather than from a page prop, because a
 * prop would have to come from the page — which is the segment that changes,
 * which is the thing we just stopped depending on.
 */
export default async function NotesWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect(signInHref("/notes"));
  }

  return (
    <div className="bg-bg-primary h-[100dvh] overflow-hidden">
      {/* These six full-height surfaces were the only signed-in pages with no
          TopBar, so they were also the only ones with no notification bell, no
          workspace switcher and no way to sign out — on `/notes` and `/chat`,
          where people spend the most time. The bar is a flex row above the
          content rather than hoisted into `(app)/layout.tsx` because the height
          model genuinely differs here: these panes scroll internally against a
          definite height, so the content takes `flex-1 min-h-0` and the bar
          keeps its natural height. The mobile gap classes stay on this wrapper
          — they clear SideNav's phone bars, which is a separate concern. */}
      <div className="rail-offset kairos-topbar-gap kairos-bottomnav-gap flex h-[100dvh] flex-col overflow-hidden">
        <TopBar />
        <main
          id="main-content"
          className="kairos-page-enter min-h-0 flex-1 overflow-hidden"
        >
          <NotesWorkspace />
        </main>
      </div>
      {/* The pages render nothing; this is here because a layout must render
          its children, and because `notFound()` from `[noteId]` has to have
          somewhere to be thrown from. */}
      {children}
    </div>
  );
}
