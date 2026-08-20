import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SideNav } from "~/components/layout/SideNav";
import { UserDisplay } from "~/components/layout/UserDisplay";
import { SettingsNav } from "~/components/layout/SettingsNav";
import { ProfileSettingsClient } from "~/components/settings/ProfileSettingsClient";
import { AppearanceSettings } from "~/components/settings/AppearanceSettings";
import { LanguageSettingsClient } from "~/components/settings/LanguageSettingsClient";
import { NotificationSettingsClient } from "~/components/settings/NotificationSettingsClient";
import { SecuritySettingsClient } from "~/components/settings/SecuritySettingsClient";
import { WorkspaceSettingsClient } from "~/components/settings/WorkspaceSettingsClient";
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";

type SearchParams = Record<string, string | string[] | undefined>;

interface SettingsPageProps {
 searchParams: Promise<SearchParams>;
}

export default async function SettingsPage({ 
 searchParams 
}: SettingsPageProps) {
 const session = await auth();
 
 if (!session?.user) {
 redirect("/api/auth/signin");
 }

 const t = await getTranslations("settings");

 const resolvedParams = await searchParams;
 const sectionParam = resolvedParams.section;
 const activeSection = typeof sectionParam === 'string' ? sectionParam : "profile";

 return (
  <div className="w-full min-h-screen bg-bg-primary pb-24 lg:pb-0">
 <SideNav />

  <div className="lg:ml-16 min-h-screen flex flex-col pt-16 lg:pt-0">
 {/* Header */}
  <header className="sticky top-16 lg:top-0 z-30 bg-bg-primary/95 backdrop-blur-md border-b border-slate-200 dark:border-white/[0.06]">
 <div className="px-4 sm:px-6 py-4 flex justify-between items-center">
 <div className="flex items-center gap-3">
 <div className="hidden sm:flex w-10 h-10 flex-shrink-0 items-center justify-center rounded-xl bg-bg-secondary border border-slate-200 dark:border-white/[0.06]">
 <Settings size={20} className="text-fg-tertiary" />
 </div>
 <div>
 <h1 className="text-[22px] font-[590] leading-[1.1] tracking-[-0.016em] text-fg-primary font-[system-ui,Kairos,sans-serif]">
 {t("title")}
 </h1>
 <p className="text-[13px] leading-[1.3] tracking-[-0.006em] text-fg-tertiary font-[system-ui,Kairos,sans-serif] mt-[2px]">
 {t("subtitle")}
 </p>
 </div>
 </div>
 <div className="flex items-center gap-3">
 <UserDisplay />
 </div>
 </div>
 </header>

  <div className="lg:hidden border-b border-slate-200 dark:border-white/[0.06]">
  <div className="px-4 py-3 overflow-x-auto">
  <div className="flex items-center gap-2 min-w-max">
  {[
  { id: "profile", label: t("nav.profile") },
  { id: "workspace", label: t("nav.workspace") },
  { id: "notifications", label: t("nav.notifications") },
  { id: "security", label: t("nav.security") },
  { id: "language", label: t("nav.language") },
  { id: "appearance", label: t("nav.appearance") },
  ].map((item) => (
  <Link
  key={item.id}
  href={`/settings?section=${item.id}`}
  className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
  activeSection === item.id
  ? "bg-accent-primary/15 text-accent-primary"
  : "bg-bg-secondary text-fg-secondary"
  }`}
  >
  {item.label}
  </Link>
  ))}
  </div>
  </div>
  </div>

  <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
  {/* Settings Navigation */}
  <aside className="hidden lg:block w-64 bg-transparent border-r border-slate-200 dark:border-white/[0.06]">
  <div className="h-full py-2">
  <SettingsNav activeSection={activeSection} variant="embedded" />
  </div>
  </aside>

  {/* Content Area */}
  <section className="flex-1 overflow-y-auto bg-bg-primary">
  <div className="w-full h-full">
  {/* Settings Content */}
  <div className="pb-24 lg:pb-8">
 {activeSection === "profile" && <ProfileSettingsClient user={session.user} />}
 {activeSection === "workspace" && <WorkspaceSettingsClient />}
 {activeSection === "notifications" && <NotificationSettingsClient />}
 {activeSection === "security" && <SecuritySettingsClient />}
 {activeSection === "language" && <LanguageSettingsClient />}
 {activeSection === "appearance" && <AppearanceSettings />}
 </div>
 </div>
 </section>
 </main>
 </div>
 </div>
 );
}
