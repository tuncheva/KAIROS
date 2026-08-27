import { auth } from "~/server/auth";
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
    redirect("/api/auth/signin");
  }

  const resolvedParams = await searchParams;
  const sectionParam = resolvedParams.section;
  const activeSection =
    typeof sectionParam === "string" && isSettingsSection(sectionParam)
      ? sectionParam
      : "profile";

  return (
    <div className="min-h-screen w-full bg-bg-primary pb-24 lg:pb-0">
      <div className="rail-offset flex min-h-screen flex-col pt-16 lg:pt-0">
        <TopBar scrim />

        <main className="settings-scroll flex flex-1 flex-col overflow-y-auto bg-bg-primary">
          <SettingsWorkspace activeSection={activeSection} user={session.user} />
        </main>
      </div>
    </div>
  );
}
