import { ProfileRouteOpener } from "~/components/profile/ProfileRouteOpener";

/**
 * A linkable address for a person.
 *
 * The profile itself is a drawer, not a page — that was the deliberate choice —
 * but a follow notification has to point somewhere, and a notification whose
 * link 404s is worse than no notification. So this route has no profile UI of
 * its own: it asks the app-wide `ProfilePeekProvider` to open the drawer on
 * this person, and leaves the page underneath empty.
 *
 * Closing the drawer navigates back, so arriving here from the bell and
 * dismissing the card returns you to wherever you were rather than stranding
 * you on a blank screen.
 */
export default async function ProfileRoutePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  return (
    <div className="rail-offset min-h-screen bg-bg-primary">
      <ProfileRouteOpener userId={userId} />
    </div>
  );
}
