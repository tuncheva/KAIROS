"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { KairosMark } from "~/components/layout/KairosMark";
import {
  Briefcase,
  LayoutDashboard,
  BookText,
  TrendingUp,
  Building2,
  Settings,
  Menu,
  X,
  MessageCircle,
  Sparkles,
  CalendarDays,
  CalendarCheck,
  Plus,
  Pin,
} from "lucide-react";

const RAIL_PIN_KEY = "kairos:railPinned";

/**
 * Every rail row carries a 2px transparent left border so the active tint can
 * fill it in without nudging the icon across.
 */
const railRowClass =
  "flex w-full items-center gap-4 border-l-2 px-5 py-[11px] text-sm whitespace-nowrap";

/**
 * Labels sit in the clipped overflow; they fade in as the rail opens.
 *
 * `kairos-rail-label` is the hook the pinned and keyboard-focus rules in
 * `globals.css` use to hold them open. It is a class rather than a second Tailwind string picked during
 * render because the pinned state is only known after hydration, and swapping
 * the class then made every label fade in again on each load.
 */
const RAIL_LABEL =
  "kairos-rail-label opacity-0 transition-opacity duration-[600ms] group-hover/rail:opacity-100 motion-reduce:transition-none";

function RailLink({
  href,
  icon: Icon,
  label,
  active,
  labelClass,
}: {
  href: string;
  icon: typeof CalendarDays;
  label: string;
  active: boolean;
  labelClass: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${railRowClass} transition-colors duration-300 ease-[cubic-bezier(0.2,0.8,0.25,1)] ${
        active
          ? "border-accent-primary bg-accent-primary/10 font-semibold text-fg-primary"
          : "border-transparent text-fg-secondary hover:bg-fg-primary/5 hover:text-fg-primary"
      }`}
    >
      <Icon size={20} className="shrink-0" />
      <span className={labelClass}>{label}</span>
    </Link>
  );
}

export function SideNav() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tOrg = useTranslations("org");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRailPinned, setIsRailPinned] = useState(false);
  const pathname = usePathname();
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

  // The rail's *appearance* while pinned now comes from CSS (see `.kairos-rail`
  // in globals.css), so this read no longer decides what gets painted. It keeps
  // the pin button's pressed state and label honest, and runs once per session
  // rather than once per navigation: the rail lives in `(app)/layout.tsx` now.
  useEffect(() => {
    setIsRailPinned(window.localStorage.getItem(RAIL_PIN_KEY) === "true");
  }, []);

  // `--rail-w` hangs off <html> so every page's `.rail-offset` shifts with the
  // rail without threading the state through each layout. It is written here
  // only when the user actually toggles the pin, never from an effect keyed on
  // `isRailPinned` — that state starts `false` and would stamp "false" over
  // whatever the pre-paint script in `themeInitScript.ts` already worked out,
  // which is exactly what made the page slide sideways after every load.
  const togglePin = () => {
    setIsRailPinned((pinned) => {
      const next = !pinned;
      window.localStorage.setItem(RAIL_PIN_KEY, String(next));
      document.documentElement.dataset.railPinned = String(next);
      return next;
    });
  };

  const labelClass = RAIL_LABEL;

  const mainNavItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: t("dashboard") },
    { href: "/projects", icon: Briefcase, label: t("projects") },
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
    { href: "/projects?new=1", icon: Plus, label: t("newProject"), primary: true },
    { href: "/calendar", icon: CalendarCheck, label: t("calendar") },
    { href: settingsItem.href, icon: Settings, label: settingsItem.label },
  ];

  const isItemActive = (href: string): boolean => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
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
    if (href === "/notes") {
      /* An open note is a route of its own (`/notes/[noteId]`, `/notes/new`),
         and the nav has to stay lit while you are reading one. */
      return pathname === "/notes" || pathname.startsWith("/notes/");
    }
    return false;
  };

  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-bg-primary/95 backdrop-blur-md shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <KairosMark size={28} />
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
                  href="/projects?new=1"
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

      {/* Design 7A rail: 64px of icons that opens to 236px on hover, on
          keyboard focus (see `:has(:focus-visible)` in globals.css — a plain
          `focus-within` kept it open after a mouse click), or stays open when
          pinned. All three feed `--rail-w`, so the page shrinks in step with
          the rail instead of being covered by it. */}
      <aside
        className={`group/rail hidden lg:flex fixed left-0 top-0 bottom-0 z-40 flex-col gap-0.5 overflow-hidden border-r border-border-light/60 bg-bg-elevated py-5 transition-[width] duration-[700ms] ease-[cubic-bezier(0.2,0.8,0.25,1)] motion-reduce:transition-none kairos-rail w-16 hover:w-[236px]`}
        aria-label="Primary"
      >
        <div className="flex items-center justify-between gap-3 whitespace-nowrap px-[18px] pb-[22px]">
          <span className="flex items-center gap-3.5">
            <KairosMark size={26} />
            <span className={`font-display text-[15px] font-semibold tracking-[0.18em] text-fg-primary ${labelClass}`}>
              KAIROS
            </span>
          </span>
          <button
            type="button"
            onClick={togglePin}
            aria-pressed={isRailPinned}
            aria-label={isRailPinned ? t("unpinNavigation") : t("pinNavigation")}
            title={isRailPinned ? t("unpinNavigation") : t("pinNavigation")}
            className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border transition-colors ${labelClass} ${
              isRailPinned
                ? "border-accent-primary/40 text-accent-primary"
                : "border-border-light/70 text-fg-tertiary hover:text-fg-primary"
            }`}
          >
            <Pin size={13} className={isRailPinned ? "fill-current" : undefined} />
          </button>
        </div>

        {mainNavItems.map((item) => (
          <RailLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={isItemActive(item.href)}
            labelClass={labelClass}
          />
        ))}

        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("kairos:openAI"))}
          aria-label="Kairos AI"
          className={`${railRowClass} border-transparent text-fg-secondary transition-colors duration-300 ease-[cubic-bezier(0.2,0.8,0.25,1)] hover:bg-fg-primary/5 hover:text-fg-primary`}
        >
          <Sparkles size={20} className="shrink-0" />
          <span className={labelClass}>Kairos AI</span>
        </button>

        <div className="min-h-6 flex-1" />

        <RailLink
          href={profileItem.href}
          icon={profileItem.icon}
          label={profileItem.label}
          active={pathname === "/orgs"}
          labelClass={labelClass}
        />
        <RailLink
          href={settingsItem.href}
          icon={settingsItem.icon}
          label={settingsItem.label}
          active={pathname === "/settings"}
          labelClass={labelClass}
        />
      </aside>
    </>
  );
}
