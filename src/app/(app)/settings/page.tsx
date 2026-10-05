import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";
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

  // The workspace covers the viewport itself (settings opens over the app, rail
  // and all); this wrapper only gives the frame a ground before it paints.
  return (
    <main id="main-content" className="min-h-dvh bg-bg-primary">
      <SettingsWorkspace activeSection={activeSection} user={session.user} />
    </main>
  );
}
