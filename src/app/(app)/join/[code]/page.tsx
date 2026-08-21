import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { JoinWithQrClient } from "~/components/orgs/JoinWithQrClient";
import { SideNav } from "~/components/layout/SideNav";
import { TopBar } from "~/components/layout/TopBar";
import { auth } from "~/server/auth";

/**
 * Where a scanned invite QR lands.
 *
 * The token in the path is not redeemed by arriving here — a scan is cheap and
 * accidental, and single-use codes must not be burnt by a link preview or a
 * misdirected camera. The page only describes what the token opens; the person
 * has to press join.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await auth();

  if (!session?.user) {
    // Same convention as the proxy: sign-in lives on the landing page, and
    // `callbackUrl` is what carries the scanned token across it. Without this the
    // scan is simply lost — the person lands on marketing copy and the one-shot
    // code they were holding never gets redeemed.
    redirect(`/?callbackUrl=${encodeURIComponent(`/join/${code}`)}`);
  }

  const t = await getTranslations("org");

  return (
    <div className="min-h-screen bg-bg-primary">
      <SideNav />
      <div className="rail-offset flex min-h-screen flex-col pt-16 lg:pt-0 kairos-page-enter">
        <TopBar title={t("joinTitle")} />

        <main id="main-content" className="w-full flex-1 overflow-auto pb-24 lg:pb-0">
          <div className="mx-auto max-w-lg px-6 py-12 md:px-8">
            <JoinWithQrClient code={code} />
          </div>
        </main>
      </div>
    </div>
  );
}
