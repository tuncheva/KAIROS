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
