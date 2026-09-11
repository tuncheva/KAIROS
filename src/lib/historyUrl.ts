/**
 * Rewriting the address bar without waking the router.
 *
 * A screen that keeps its own view state — which settings tab is open, which
 * calendar period is showing — wants the URL to follow along so the view
 * deep-links and survives a reload. The obvious way to do that is
 * `window.history.replaceState(null, "", url)`, and in the App Router it is not
 * free the way it looks.
 *
 * Next patches `replaceState`. Given a state object it does not recognise, it
 * dispatches `ACTION_RESTORE` at the router, whose reducer calls
 * `spawnDynamicRequests` — a fresh RSC request for the new URL. On a dynamic
 * route with a `loading.tsx`, that is a skeleton flash and a re-render on every
 * click, which is exactly the round trip the client-side state was there to
 * avoid. It also swallows the interaction: the click that changed the tab
 * appears to do nothing, because the route it triggered replaces the panel that
 * was mid-change.
 *
 * The patch has an escape hatch, and it is the one Next's own navigations use:
 * a state object already carrying `__NA` is passed straight through to the
 * native `replaceState`. Every app-router history entry carries it, so handing
 * back `window.history.state` untouched changes the URL and nothing else.
 *
 * The trade, and the reason this is not the default everywhere:
 *
 * - `useSearchParams()` and `usePathname()` do **not** update. A caller that
 *   derives render state from those hooks must keep using the plain
 *   `history.replaceState` and pay for the round trip, or it will read a URL
 *   that no longer exists. Callers here hold the state themselves, which is
 *   what makes the bypass correct for them.
 * - Replace only. `pushState` needs the router to record a tree against the new
 *   entry, or Back restores a tree that does not match its URL.
 */
export function replaceUrlSilently(url: string): void {
  if (typeof window === "undefined") return;

  /* `history.state` rather than `null`. If it somehow carries no `__NA` — an
     entry written before the router mounted — this falls through to Next's
     sync path, which is today's behaviour rather than a new failure. */
  window.history.replaceState(window.history.state, "", url);
}
