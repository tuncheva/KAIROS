import { notFound } from "next/navigation";

/**
 * A note is a route, not component state.
 *
 * That is what makes the browser back button work when the mobile layout swaps
 * the list for the note, and lets a share notification land on the right one
 * instead of racing a timeout against the query.
 *
 * The surface is in `../layout.tsx` so that moving between notes does not
 * remount it. What is left here is the one thing that genuinely belongs to this
 * segment: rejecting an id that is not a positive integer. `/notes/new` is a
 * sibling static route so it never reaches this file, but any other non-numeric
 * path would otherwise become a query for note NaN.
 *
 * The session check is in the layout, which runs first and covers all three
 * routes — so it is not repeated here.
 */
export default async function NotePageRoute({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;
  const id = Number(noteId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  return null;
}
