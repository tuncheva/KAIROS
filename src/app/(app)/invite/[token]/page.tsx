import { redirect } from "next/navigation";

import { AcceptInviteClient } from "~/components/orgs/AcceptInviteClient";
import { TopBar } from "~/components/layout/TopBar";
import { auth } from "~/server/auth";

/**
 * Where an emailed workspace invitation lands.
 *
 * Like the QR landing page, arriving does not accept anything — mail scanners
 * and link previews open links too. The page shows what the invite grants and
 * the person presses accept.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();

  if (!session?.user) {
    // Someone new signs up from here and comes straight back; the invite is
    // bound to their address, so it is waiting for them when they do.
    redirect(`/?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset flex min-h-dvh flex-col kairos-topbar-gap kairos-page-enter">
        <TopBar />

        <main id="main-content" className="w-full flex-1 overflow-auto kairos-bottomnav-gap">
          <div className="mx-auto max-w-lg px-6 py-12 md:px-8">
            <AcceptInviteClient token={token} />
          </div>
        </main>
      </div>
    </div>
  );
}
