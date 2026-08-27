"use client";

/**
 * Makes anything that represents a person open their profile.
 *
 * Wrapping rather than replacing each avatar is what kept this change small:
 * the events feed, the collaborator list and the project rows each draw their
 * own avatar at their own size, and none of them had to change shape to become
 * tappable.
 *
 * It renders a real `<button>`, so keyboard focus and Enter/Space come for
 * free — the alternative, an `onClick` on a `<div>`, would have made every
 * avatar in the app unreachable without a mouse.
 */

import { useProfilePeek } from "./ProfilePeekProvider";

export function ProfileLink({
  userId,
  name,
  className = "",
  children,
}: {
  /** Null when the row has no real user behind it — renders inert. */
  userId: string | null | undefined;
  /** Used for the accessible name; the visible label is `children`. */
  name?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const { openProfile } = useProfilePeek();

  if (!userId) return <>{children}</>;

  return (
    <button
      type="button"
      onClick={(event) => {
        // Avatars sit inside cards that are themselves clickable. Without this,
        // tapping a face would open the profile *and* navigate the card.
        event.stopPropagation();
        event.preventDefault();
        openProfile(userId);
      }}
      aria-label={name ? `View ${name}'s profile` : "View profile"}
      className={`cursor-pointer rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent-primary ${className}`}
    >
      {children}
    </button>
  );
}
