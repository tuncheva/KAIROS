import { Geist_Mono, Hanken_Grotesk, Newsreader } from "next/font/google";
import { getLocale } from "next-intl/server";
import { auth } from "~/server/auth";
import { signInHref } from "~/lib/routes";
import { redirect } from "next/navigation";
import { SettingsWorkspace } from "~/components/settings/SettingsWorkspace";
import { isSettingsSection } from "~/components/settings/sections";

/*
 * The two faces of the settings space, loaded here rather than in the root
 * layout so no other route pays for them. Neither carries Cyrillic (Hanken
 * Grotesk has only the extended block), so for Bulgarian the variables are left
 * off and `.settings-elegant` falls back to the app sans and the quiet serif —
 * one face per line, rather than Latin in one and Cyrillic in another.
 */
const settingsSerif = Newsreader({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

const settingsSans = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-hanken",
  display: "swap",
});

// Codes, keys and URLs. Unlike the other two it carries Cyrillic, so it loads
// for every locale.
const settingsMono = Geist_Mono({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-settings-mono",
  display: "swap",
});

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
  const fonts =
    locale === "bg"
      ? settingsMono.variable
      : `${settingsSerif.variable} ${settingsSans.variable} ${settingsMono.variable}`;

  // The workspace covers the viewport itself (settings opens over the app, rail
  // and all); this wrapper only carries the font variables and a ground for the
  // frame before it paints.
  return (
    <main id="main-content" className={`min-h-dvh bg-bg-primary ${fonts}`}>
      <SettingsWorkspace activeSection={activeSection} user={session.user} />
    </main>
  );
}
