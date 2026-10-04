import "@fontsource-variable/newsreader/wght.css";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource-variable/hanken-grotesk/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import { getLocale } from "next-intl/server";
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

  const locale = await getLocale();
  const fonts = locale === "bg" ? "settings-fonts-mono-only" : "settings-fonts";

  // The workspace covers the viewport itself (settings opens over the app, rail
  // and all); this wrapper only carries the font variables and a ground for the
  // frame before it paints.
  return (
    <main id="main-content" className={`min-h-dvh bg-bg-primary ${fonts}`}>
      <SettingsWorkspace activeSection={activeSection} user={session.user} />
    </main>
  );
}
