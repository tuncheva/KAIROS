"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  LayoutDashboard,
  BookText,
  TrendingUp,
  Building2,
  Settings,
  Menu,
  X,
  SquarePen,
  MessageCircle,
  Sparkles,
  CalendarDays,
  CalendarCheck,
  Plus,
} from "lucide-react";

export function SideNav() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tOrg = useTranslations("org");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mobileNavId = "mobile-nav-menu";

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileMenuOpen]);

  const action = searchParams?.get("action");

  const mainNavItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: t("dashboard") },
    { href: "/projects", icon: Briefcase, label: t("projects") },
    { href: "/create", icon: SquarePen, label: t("create") },
    { href: "/notes", icon: BookText, label: t("notes") },
    { href: "/progress", icon: TrendingUp, label: t("progress") },
    { href: "/calendar", icon: CalendarCheck, label: t("calendar") },
    { href: "/chat", icon: MessageCircle, label: t("chat") },
    { href: "/publish", icon: CalendarDays, label: t("events") },
  ];

  const profileItem = { href: "/orgs", icon: Building2, label: tOrg("yourOrgs") };

  const settingsItem = { href: "/settings?section=profile", icon: Settings, label: t("settings") };
  const mobileBottomItems: Array<{
    href: string;
    icon: typeof CalendarDays;
    label: string;
    primary?: boolean;
  }> = [
    { href: "/publish", icon: CalendarDays, label: t("events") },
    { href: "/progress", icon: TrendingUp, label: t("progress") },
    { href: "/create?action=new_project", icon: Plus, label: t("newProject"), primary: true },
    { href: "/calendar", icon: CalendarCheck, label: t("calendar") },
    { href: settingsItem.href, icon: Settings, label: settingsItem.label },
  ];

  const isItemActive = (href: string): boolean => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    if (href === "/create") {
      return pathname === "/create" && !action;
    }
    if (href === "/progress") {
      return pathname === "/progress";
    }
    if (href === "/chat") {
      return pathname === "/chat";
    }
    if (href === "/publish") {
      return pathname === "/publish";
    }
    if (href === "/calendar") {
      return pathname === "/calendar";
    }
    if (href === "/projects") {
      return pathname === "/projects";
    }
    if (href.startsWith("/settings")) {
      return pathname === "/settings";
    }
    if (href === "/create?action=new_project") {
      return pathname === "/create" && action === "new_project";
    }
    if (href === "/notes") {
      return pathname === "/notes";
    }
    return false;
  };

  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-bg-primary/95 backdrop-blur-md shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center shadow-lg shadow-accent-primary/25">
            <span className="text-white font-bold text-sm">K</span>
          </div>
          <h1 className="text-lg font-semibold text-fg-primary font-display tracking-[-0.02em]">KAIROS</h1>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 hover:bg-bg-secondary/60 rounded-lg transition-colors"
          aria-label={isMobileMenuOpen ? tCommon("close") : tCommon("menu")}
          aria-expanded={isMobileMenuOpen}
          aria-controls={mobileNavId}
          title={isMobileMenuOpen ? tCommon("close") : tCommon("menu")}
        >
          {isMobileMenuOpen ? (
            <X size={24} className="text-fg-primary" />
          ) : (
            <Menu size={24} className="text-fg-primary" />
          )}
        </button>
      </div>

      {isMobileMenuOpen && (
        <>
          <div 
            className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fadeIn"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            id={mobileNavId}
            role="dialog"
            aria-label="Navigation"
            className="lg:hidden fixed left-0 top-0 bottom-0 w-72 bg-bg-primary z-50 shadow-2xl pt-16 animate-slideIn"
          >
            <nav className="flex flex-col gap-1 p-3" aria-label="Primary">
              {mainNavItems.map((item) => {
                const isActive = isItemActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                    }}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors font-medium ${
                      isActive
                        ? "bg-accent-primary/10 text-accent-primary ring-1 ring-accent-primary/25 shadow-sm font-semibold"
                        : "text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary"
                    }`}
                  >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  window.dispatchEvent(new CustomEvent("kairos:openAI"));
                }}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors font-medium text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary w-full"
              >
                <Sparkles size={20} />
                <span>Kairos AI</span>
              </button>

              <Link
                href={profileItem.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors font-medium text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary`}
                title={profileItem.label}
              >
                <profileItem.icon size={20} />
                <span>{profileItem.label}</span>
              </Link>

              <Link
                href={settingsItem.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors font-medium ${
                  pathname === "/settings"
                    ? "bg-accent-primary/10 text-accent-primary ring-1 ring-accent-primary/25 shadow-sm font-semibold"
                    : "text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary"
                }`}
                title={settingsItem.label}
              >
                <settingsItem.icon size={20} />
                <span>{settingsItem.label}</span>
              </Link>
              
              <div className="mt-6 pt-6">
                <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-3 px-4">
                  {t("quickActions")}
                </p>
                <Link
                  href="/create?action=new_project"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-accent-primary hover:bg-accent-primary/10 transition-colors shadow-sm font-medium"
                  title={t("newProject")}
                >
                  <Plus size={20} />
                  <span>{t("newProject")}</span>
                </Link>
              </div>
            </nav>
          </div>
        </>
      )}

      <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-bg-primary/95 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-md dark:border-white/[0.06] ${isMobileMenuOpen ? "hidden" : ""}`} aria-label="Primary">
        <div className="flex items-center justify-around gap-1">
          {mobileBottomItems.map((item) => {
            const isActive = isItemActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={`flex h-11 min-w-11 items-center justify-center rounded-xl transition-colors ${
                  item.primary
                    ? "bg-accent-primary text-white shadow-md shadow-accent-primary/30"
                    : isActive
                      ? "bg-accent-primary/12 text-accent-primary"
                      : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
                }`}
                title={item.label}
              >
                <item.icon size={20} />
              </Link>
            );
          })}
        </div>
      </nav>

      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-16 bg-bg-primary/95 backdrop-blur-md shadow-lg flex-col items-center py-8 gap-6 z-40" aria-label="Primary">
        <div className="flex flex-col items-center gap-6">
          {mainNavItems.map((item) => {
            const isActive = isItemActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors group relative ${
                  isActive
                    ? "bg-accent-primary/10 text-accent-primary ring-1 ring-accent-primary/25 shadow-sm"
                    : "text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary"
                }`}
                title={item.label}
              >
                <item.icon size={20} />

                <span className="absolute left-full ml-4 px-3 py-1.5 bg-bg-elevated border border-slate-200 dark:border-white/[0.06] text-fg-primary text-sm rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-50">
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("kairos:openAI"))}
            aria-label="Kairos AI"
            title="Kairos AI"
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors group relative text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary"
          >
            <Sparkles size={20} />
            <span className="absolute left-full ml-4 px-3 py-1.5 bg-bg-elevated border border-slate-200 dark:border-white/[0.06] text-fg-primary text-sm rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-50">
              Kairos AI
            </span>
          </button>
        </div>

        <div className="mt-auto flex flex-col items-center gap-4">
          <Link
            href={profileItem.href}
            aria-label={profileItem.label}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors group relative ${
              pathname === "/orgs"
                ? "bg-accent-primary/10 text-accent-primary ring-1 ring-accent-primary/25 shadow-sm"
                : "text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary"
            }`}
            title={profileItem.label}
          >
            <profileItem.icon size={20} />
            <span className="absolute left-full ml-4 px-3 py-1.5 bg-bg-elevated border border-slate-200 dark:border-white/[0.06] text-fg-primary text-sm rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-50">
              {profileItem.label}
            </span>
          </Link>

          <Link
            href={settingsItem.href}
            aria-label={settingsItem.label}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors group relative ${
              pathname === "/settings"
                ? "bg-accent-primary/10 text-accent-primary ring-1 ring-accent-primary/25 shadow-sm"
                : "text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary"
            }`}
            title={settingsItem.label}
          >
            <settingsItem.icon size={20} />
            <span className="absolute left-full ml-4 px-3 py-1.5 bg-bg-elevated border border-slate-200 dark:border-white/[0.06] text-fg-primary text-sm rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-50">
              {settingsItem.label}
            </span>
          </Link>
        </div>
      </aside>
    </>
  );
}
