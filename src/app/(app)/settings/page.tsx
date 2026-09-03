import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";
import { TopBar } from "~/components/layout/TopBar";
import { SettingsWorkspace } from "~/components/settings/SettingsWorkspace";
import { isSettingsSection } from "~/components/settings/sections";

type SearchParams = Record<string, string | string[] | undefined>;

interface SettingsPageProps {
  searchParams: Promise<SearchParams>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await auth();

  if (!session?.user) {
    redirect(signInHref("/settings"));
  }

  const resolvedParams = await searchParams;
  const sectionParam = resolvedParams.section;
  const activeSection =
    typeof sectionParam === "string" && isSettingsSection(sectionParam)
      ? sectionParam
      : "profile";

  return (
    <div className="min-h-dvh w-full bg-bg-primary">
      <div className="rail-offset flex min-h-dvh flex-col kairos-topbar-gap">
        <TopBar scrim />

        <main id="main-content" className="settings-scroll flex flex-1 flex-col overflow-y-auto bg-bg-primary">
          <SettingsWorkspace activeSection={activeSection} user={session.user} />
        </main>
      </div>
    </div>
  );
}
