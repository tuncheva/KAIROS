import { SideNav } from "~/components/layout/SideNav";
import { ProfilePeekProvider } from "~/components/profile/ProfilePeekProvider";

/**
 * The shell every signed-in page sits inside.
 *
 * ## Why this file exists
 *
 * Each page used to render `<SideNav />` itself. Because a route group without a
 * layout gives its pages no shared boundary, that put the rail inside the page
 * segment — so every navigation unmounted it and mounted a fresh one. Three
 * things fell out of that, all of them visible:
 *
 * - The rail's pinned state is read from `localStorage` in an effect, so it
 *   started every navigation collapsed and widened again a frame later. Since
 *   the pinned width feeds `--rail-w`, and `.rail-offset` transitions its
 *   `margin-left` off that variable, the whole page slid sideways for 400ms
 *   after each navigation.
 * - The rail's own `transition-[width]` re-ran, so the labels faded in again.
 * - Its translations, icon components and handlers were rebuilt every time.
 *
 * Hoisting it here makes it a sibling of `children` in the segment tree, which
 * is what lets React keep the exact same DOM across a navigation. The rail now
 * mounts once per session and simply re-renders its active row.
 *
 * It also means the rail stays on screen while a page's `loading.tsx` is up,
 * instead of disappearing and coming back.
 *
 * ## What is deliberately *not* here
 *
 * `ProfilePeekProvider` *is* here, for the same reason `SideNav` is: it owns the
 * one profile drawer the whole app opens, and hoisting it means the drawer
 * survives the navigation it triggers — tapping a shared project inside the
 * drawer routes `children` underneath while the drawer stays put. It also owns
 * the presence heartbeat, which has to beat once per session rather than once
 * per page.
 *
 * `TopBar`, and the page's own column wrapper. Pages disagree about both — the
 * chat, notes and events pages have no top bar at all, and the height model
 * splits between `min-h-dvh` and a definite `h-[100dvh]` for the surfaces
 * that scroll internally. Hoisting those would mean encoding per-route
 * exceptions in the layout, so each page still owns its column. The bar's cost
 * was never the markup anyway; it was the queries behind it, and those are now
 * cached across navigations instead (see `~/trpc/queryClient`).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfilePeekProvider>
      <SideNav />
      {children}
    </ProfilePeekProvider>
  );
}
