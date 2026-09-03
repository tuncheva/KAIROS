/**
 * Canonical hrefs for routes that more than one surface links to.
 *
 * The command palette used to build its own `/projects/{id}` string, which was
 * never a route — the same wrong guess was independently written in
 * `ConversationDetails`. Two copies of a link is two chances to point at a page
 * that does not exist, so the ones that had drifted live here now and the
 * `paletteHrefsResolve` test asserts they still land on a real file.
 */

/** Where a project opens. There is no `/projects/[id]` route; the list reads the query param. */
export const projectHref = (id: number | string) => `/projects?projectId=${String(id)}`;

/** A project's task board. The board is a tab on the projects page, not a route. */
export const projectTasksHref = (id: number | string) =>
  `/projects?projectId=${String(id)}&tab=tasks`;

/** A note. Unlike projects, this one really is a route. */
export const noteHref = (id: number | string) => `/notes/${String(id)}`;

/** An event's public page — the one that unfurls when shared. */
export const eventHref = (id: number | string) => `/events/${String(id)}`;

/**
 * Where a page sends someone whose session has gone.
 *
 * Every `(app)` page hand-rolled this, and they disagreed: eleven redirected to
 * `/api/auth/signin` — NextAuth's own unstyled page, which is not this app's
 * sign-in and forgets where the user was going — and the three `notes` routes
 * redirected to `/` with nothing at all, so the user landed on the marketing
 * page with no explanation and no way back to what they had open.
 *
 * `callbackUrl` is what `HomeClient` reads to open the sign-in box instead of
 * the landing page; `reason` is what turns it into "your session expired"
 * rather than an unexplained modal.
 */
export const signInHref = (callbackUrl: string, reason: "expired" = "expired") =>
  `/?callbackUrl=${encodeURIComponent(callbackUrl)}&reason=${reason}`;
