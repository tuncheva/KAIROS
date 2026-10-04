"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { KairosMark } from "~/components/layout/KairosMark";
import { openOnboarding } from "~/components/onboarding/OnboardingSheet";
import { avatarGradientStyle } from "~/lib/avatarGradient";
import { api } from "~/trpc/react";
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
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "~/components/ui/icons";

const RAIL_COLLAPSED_KEY = "kairos:railCollapsed";

/** The collapsed rail, in px (`w-[68px]`). The tooltip is only for this width. */
const RAIL_COLLAPSED_WIDTH = 68;

/**
 * Design 1b rows: 36px tall, a 16px icon, and a quiet tint for the active one.
 *
 * The rail is `px-3.5` and a row is `px-3`, so the icon sits 26px in whichever
 * width the rail is at — collapsing only takes the labels away, the icons never
 * move.
 */
const railRowClass =
  "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13.5px] whitespace-nowrap transition-colors duration-200";

/**
 * Anything that only belongs to the open sidebar — labels, group headings,
 * counts, key hints. `globals.css` hides it under `data-rail-collapsed`, which
 * the pre-paint script stamps before the first frame, so a collapsed rail never
 * flashes its labels on load the way a class picked off React state would.
 */
const RAIL_LABEL = "kairos-rail-label";

function railRowTone(active: boolean): string {
  return active
    ? "bg-tui-ink/[0.055] font-semibold text-tui-ink"
    : "font-medium text-tui-ink2 hover:bg-tui-ink/[0.055] hover:text-tui-ink";
}

/**
 * Collapsed, the rail is eight unlabelled icons, and `title` never shows on a
 * touch screen and takes a second on a mouse. So each row carries its own tip.
 *
 * Position is `fixed` and measured, not `absolute`: the rail is
 * `overflow-hidden`, so anything absolutely positioned past its edge is cut
 * off. `fixed` escapes the clip — nothing on the rail's ancestor chain sets a
 * transform, so it resolves against the viewport as intended.
 */
function useRailTip() {
  const [top, setTop] = useState<number | null>(null);

  const show = (el: HTMLElement | null) => {
    if (!el) return;
    /* Only while the rail is shut. Open, the row's label is already on screen
       and the tip would land on top of it. Measured rather than read from
       state so it is right mid-animation too. */
    const rail = el.closest(".kairos-rail");
    if (rail && rail.getBoundingClientRect().width > RAIL_COLLAPSED_WIDTH + 8) {
      return;
    }
    const box = el.getBoundingClientRect();
    setTop(box.top + box.height / 2);
  };
  const hide = () => setTop(null);

  return { top, show, hide };
}

function RailTip({ top, label }: { top: number | null; label: string }) {
  if (top === null) return null;
  /* aria-hidden: the label span is already the accessible name, and a screen
     reader announcing it twice is worse than not at all. */
  return (
    <span aria-hidden="true" className="kairos-rail-tip" style={{ top }}>
      {label}
    </span>
  );
}

function RailCount({ count, active }: { count: number; active: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={`${RAIL_LABEL} text-[11.5px] tabular-nums ${
        active ? "text-tui-accent" : "text-tui-ink3"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function RailLink({
  href,
  icon: Icon,
  label,
  active,
  count = 0,
}: {
  href: string;
  icon: typeof CalendarDays;
  label: string;
  active: boolean;
  count?: number;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const tip = useRailTip();

  return (
    <Link
      ref={ref}
      href={href}
      aria-current={active ? "page" : undefined}
      /* The label is `display: none` on the collapsed rail, which would take
         the accessible name with it. */
      aria-label={label}
      onMouseEnter={() => tip.show(ref.current)}
      onMouseLeave={tip.hide}
      onClick={tip.hide}
      className={`${railRowClass} ${railRowTone(active)}`}
    >
      <Icon
        size={16}
        className={`shrink-0 ${active ? "text-tui-accent" : "text-tui-ink3"}`}
      />
      <span className={`${RAIL_LABEL} min-w-0 flex-1`}>{label}</span>
      <RailCount count={count} active={active} />
      <RailTip top={tip.top} label={label} />
    </Link>
  );
}

/** A rail row that is an action rather than a destination — Ask Kairos. */
function RailButton({
  onClick,
  icon: Icon,
  label,
  hint,
}: {
  onClick: () => void;
  icon: typeof CalendarDays;
  label: string;
  hint?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const tip = useRailTip();

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => {
        tip.hide();
        onClick();
      }}
      onMouseEnter={() => tip.show(ref.current)}
      onMouseLeave={tip.hide}
      aria-label={label}
      className={`${railRowClass} font-medium text-tui-ink hover:bg-tui-ink/[0.055]`}
    >
      <Icon size={16} className="shrink-0 text-tui-accent" />
      <span className={`${RAIL_LABEL} min-w-0 flex-1`}>{label}</span>
      {hint ? (
        <kbd className={`${RAIL_LABEL} font-mono text-[10.5px] text-tui-ink3`}>{hint}</kbd>
      ) : null}
      <RailTip top={tip.top} label={label} />
    </button>
  );
}

function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

export function SideNav() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tOrg = useTranslations("org");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  // "Ctrl" until mounted, so the server and first client render agree.
  const [modKey, setModKey] = useState("Ctrl");
  const { status } = useSession();
  const pathname = usePathname();
  const mobileNavId = "mobile-nav-menu";

  // Escape closes the sheet, and while it is open the page behind it must not
  // scroll. On a phone that is not a nicety: without the lock, dragging
  // anywhere on the (full-screen) backdrop scrolls the page underneath, and on
  // iOS a drag that starts at the top edge fires pull-to-refresh and reloads
  // the app out from under the open menu. `position: fixed` is the only lock
  // Safari honours, so the scroll offset is saved and restored by hand.
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    };

    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isMobileMenuOpen]);

  // A rotation or a resize past `lg` leaves the sheet mounted but its backdrop
  // `lg:hidden`, which strands the scroll lock with no visible way to undo it.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (desktop.matches) setIsMobileMenuOpen(false);
    };
    onChange();
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [isMobileMenuOpen]);

  // The rail's *appearance* while collapsed comes from CSS (see `.kairos-rail`
  // in globals.css), so this read does not decide what gets painted. It keeps
  // the toggle's label and icon honest, and runs once per session rather than
  // once per navigation: the rail lives in `(app)/layout.tsx`.
  useEffect(() => {
    setIsRailCollapsed(window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "true");
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setModKey("⌘");
  }, []);

  // `--rail-w` hangs off <html> so every page's `.rail-offset` shifts with the
  // rail without threading the state through each layout. It is written here
  // only when the user actually toggles, never from an effect keyed on
  // `isRailCollapsed` — that state starts `false` and would stamp "false" over
  // whatever the pre-paint script in `themeInitScript.ts` already worked out,
  // which would slide the page sideways after every load. The next value is
  // read off <html> for the same reason: it is the one source that is right
  // before hydration too.
  const toggleRail = () => {
    const next = document.documentElement.dataset.railCollapsed !== "true";
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, String(next));
    document.documentElement.dataset.railCollapsed = String(next);
    setIsRailCollapsed(next);
  };

  const openAI = () => window.dispatchEvent(new CustomEvent("kairos:openAI"));
  const openPalette = () => window.dispatchEvent(new CustomEvent("kairos:openPalette"));

  // Mod+\ collapses and expands the rail; Mod+J opens Kairos AI. Mod+K belongs
  // to `GlobalAIWidget`, which owns the palette. Both are desktop-only: below
  // `lg` there is no rail to toggle.
  const toggleRailRef = useRef(toggleRail);
  toggleRailRef.current = toggleRail;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      if (e.key === "\\") {
        e.preventDefault();
        toggleRailRef.current();
      } else if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("kairos:openAI"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const signedIn = status === "authenticated";
  const { data: user } = api.user.getCurrentUser.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  const { data: activeOrg } = api.organization.getActive.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  // `ChatShell` invalidates this whenever a thread is read or a message lands.
  const { data: unread } = api.chat.getUnreadTotal.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 1000 * 30,
  });
  const unreadChats = unread?.total ?? 0;

  const roleLabels: Record<string, string> = {
    admin: tOrg("roleAdmin"),
    member: tOrg("roleWorker"),
    worker: tOrg("roleWorker"),
    mentor: tOrg("roleMentor"),
    guest: tOrg("roleGuest"),
  };
  const workspaceName = activeOrg?.organization.name ?? tOrg("personalWorkspace");
  const workspaceSubtitle = activeOrg
    ? (roleLabels[activeOrg.role] ?? activeOrg.role)
    : tOrg("personalSubtitle");

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
    /* The five destinations people actually reach for. This used to be Events ·
       Progress · New · Calendar · Settings, which left Dashboard, Projects,
       Chat and Notes reachable only through the hamburger — four of the five
       most-used surfaces behind an extra tap. The ones that moved out are all
       still in the drawer, which is where secondary destinations belong. */
    { href: "/dashboard", icon: LayoutDashboard, label: t("dashboard") },
    { href: "/projects", icon: Briefcase, label: t("projects") },
    { href: "/projects?new=1", icon: Plus, label: t("newProject"), primary: true },
    { href: "/chat", icon: MessageCircle, label: t("chat") },
    { href: "/notes", icon: BookText, label: t("notes") },
  ];

  const isItemActive = (href: string): boolean => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    if (href === "/progress") {
      return pathname === "/progress";
    }
    if (href === "/chat") {
      /* A conversation is its own route (`/chat/[conversationId]`, `/chat/ai`),
         and the nav has to stay lit while you are reading one — same reasoning
         as notes below. */
      return pathname === "/chat" || pathname.startsWith("/chat/");
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

  /* Design 1b groups the destinations by what they are for. Organizations sits
     with Chat under Collaboration rather than in the footer: it is where you
     manage the people, and the footer is kept for you and your settings. */
  const railGroups: Array<{
    label: string;
    items: Array<{ href: string; icon: typeof CalendarDays; label: string; count?: number }>;
  }> = [
    {
      label: t("groupWorkspace"),
      items: [
        { href: "/dashboard", icon: LayoutDashboard, label: t("dashboard") },
        { href: "/projects", icon: Briefcase, label: t("projects") },
        { href: "/calendar", icon: CalendarCheck, label: t("calendar") },
        { href: "/publish", icon: CalendarDays, label: t("events") },
      ],
    },
    {
      label: t("groupInsights"),
      items: [
        { href: "/notes", icon: BookText, label: t("notes") },
        { href: "/progress", icon: TrendingUp, label: t("progress") },
      ],
    },
    {
      label: t("groupCollaboration"),
      items: [
        { href: "/chat", icon: MessageCircle, label: t("chat"), count: unreadChats },
        { href: profileItem.href, icon: profileItem.icon, label: profileItem.label },
      ],
    },
  ];

  const hint = (key: string) => (modKey === "⌘" ? `⌘${key}` : `Ctrl ${key}`);
  const toggleLabel = isRailCollapsed ? t("expandNavigation") : t("collapseNavigation");
  const avatarSrc = user?.image ?? null;

  return (
    <>
      <div className="kairos-mobile-topbar lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-tui-pane/95 pb-3 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={openOnboarding}
            title={t("gettingStarted")}
            className="flex items-center gap-2.5 rounded-lg transition-opacity hover:opacity-70"
          >
            <KairosMark size={28} />
            <h1 className="text-lg font-semibold text-tui-ink font-display tracking-[-0.02em]">KAIROS</h1>
          </button>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-tui-ink/[0.055]"
          aria-label={isMobileMenuOpen ? tCommon("close") : tCommon("menu")}
          aria-expanded={isMobileMenuOpen}
          aria-controls={mobileNavId}
          title={isMobileMenuOpen ? tCommon("close") : tCommon("menu")}
        >
          {isMobileMenuOpen ? (
            <X size={24} className="text-tui-ink" />
          ) : (
            <Menu size={24} className="text-tui-ink" />
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
            /* `w-72` is 288px — wider than 85% of a 320px phone, which left the
               page behind it as a 32px sliver you could not actually aim at.
               The sheet also scrolls: eleven rows plus the quick-actions block
               is taller than a landscape phone. */
            className="kairos-topbar-gap kairos-sheet-left kairos-scroll-area animate-slideIn fixed bottom-0 left-0 top-0 z-50 w-[min(18rem,85vw)] overflow-y-auto bg-tui-pane shadow-2xl lg:hidden"
          >
            <nav className="kairos-safe-bottom flex flex-col gap-1 p-3 pb-6" aria-label="Primary">
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
                        ? "bg-tui-accent/10 text-tui-accent ring-1 ring-tui-accent/25 shadow-sm font-semibold"
                        : "text-tui-ink2 hover:bg-tui-ink/[0.055] hover:text-tui-ink"
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
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors font-medium text-tui-ink2 hover:bg-tui-ink/[0.055] hover:text-tui-ink w-full"
              >
                <Sparkles size={20} />
                <span>Kairos AI</span>
              </button>

              <Link
                href={profileItem.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors font-medium text-tui-ink2 hover:bg-tui-ink/[0.055] hover:text-tui-ink`}
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
                    ? "bg-tui-accent/10 text-tui-accent ring-1 ring-tui-accent/25 shadow-sm font-semibold"
                    : "text-tui-ink2 hover:bg-tui-ink/[0.055] hover:text-tui-ink"
                }`}
                title={settingsItem.label}
              >
                <settingsItem.icon size={20} />
                <span>{settingsItem.label}</span>
              </Link>
              
              <div className="mt-6 pt-6">
                <p className="text-xs font-semibold text-tui-ink2 uppercase tracking-wider mb-3 px-4">
                  {t("quickActions")}
                </p>
                <Link
                  href="/projects?new=1"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-tui-accent hover:bg-tui-accent/10 transition-colors shadow-sm font-medium"
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

      {/* z-50, above `AskKairosLauncher`. Both sat at z-40 and the launcher
          renders later in the tree, so it won every time — covering the last
          item on every phone. The launcher also lifts to `bottom-24` to clear
          this bar; the toast viewport uses the same clearance. */}
      <nav className={`kairos-mobile-bottomnav fixed bottom-0 left-0 right-0 z-50 border-t border-tui-ink/8 bg-tui-pane/95 pt-2 backdrop-blur-md lg:hidden ${isMobileMenuOpen ? "hidden" : ""}`} aria-label="Primary">
        <div className="flex items-center justify-around gap-1">
          {mobileBottomItems.map((item) => {
            const isActive = isItemActive(item.href);
            return (
              /* Labelled, not icon-only. The old bar carried `title`, which a
                 touch device never shows, so the whole bar was five unnamed
                 glyphs. The visible text is also the accessible name now, so
                 there is no `aria-label` to drift out of step with it. */
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors ${
                  item.primary
                    ? "text-tui-accent"
                    : isActive
                      ? "text-tui-accent"
                      : "text-tui-ink3 hover:text-tui-ink"
                }`}
              >
                <span
                  className={
                    item.primary
                      ? "grid h-7 w-9 place-items-center rounded-full bg-tui-accent text-tui-on-accent"
                      : "grid h-7 w-9 place-items-center"
                  }
                >
                  <item.icon size={item.primary ? 22 : 20} />
                </span>
                <span className="text-[10px] font-semibold leading-none">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Design 1b sidebar: 248px, labelled and grouped, collapsing to a 68px
          rail of icons from its own toggle or Mod+\. The collapsed state is
          drawn from `data-rail-collapsed` on <html> (see `.kairos-rail` in
          globals.css) and feeds `--rail-w`, so the page narrows and widens in
          step with the rail instead of being covered by it. */}
      <aside
        className="kairos-rail hidden lg:flex fixed left-0 top-0 bottom-0 z-40 w-[248px] flex-col overflow-hidden border-r border-tui-ink/8 bg-tui-pane px-3.5 pt-[18px] pb-4 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        aria-label="Primary"
      >
        <div className="kairos-rail-head mb-[18px] flex h-9 shrink-0 items-center gap-2.5 pr-1.5 pl-2">
          <button
            type="button"
            onClick={openOnboarding}
            aria-label={t("gettingStarted")}
            title={t("gettingStarted")}
            className="flex shrink-0 items-center rounded-md transition-opacity hover:opacity-70"
          >
            <KairosMark size={20} />
          </button>
          <Link
            href={profileItem.href}
            title={tOrg("switchWorkspace")}
            className={`${RAIL_LABEL} flex min-w-0 flex-1 flex-col gap-px whitespace-nowrap transition-opacity hover:opacity-75`}
          >
            <span className="truncate text-[13.5px] font-semibold text-tui-ink">{workspaceName}</span>
            <span className="truncate text-[11.5px] text-tui-ink3">{workspaceSubtitle}</span>
          </Link>
          <button
            type="button"
            onClick={toggleRail}
            aria-expanded={!isRailCollapsed}
            aria-label={toggleLabel}
            title={`${toggleLabel} (${hint("\\")})`}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-tui-ink3 transition-colors hover:bg-tui-ink/[0.055] hover:text-tui-ink"
          >
            {isRailCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>

        {/* The palette's door, same as `SearchTrigger` in the top bar. */}
        <button
          type="button"
          onClick={openPalette}
          aria-label={tCommon("search")}
          title={`${tCommon("search")} (${hint("K")})`}
          className="mb-[22px] flex h-[34px] w-full shrink-0 items-center gap-2.5 rounded-lg bg-tui-ink/[0.055] pr-2.5 pl-3 text-left text-[13px] whitespace-nowrap text-tui-ink3 transition-colors hover:text-tui-ink"
        >
          <Search size={14} className="shrink-0" />
          <span className={`${RAIL_LABEL} flex-1`}>{tCommon("search")}</span>
          <kbd className={`${RAIL_LABEL} rounded border border-tui-ink/12 px-[5px] font-mono text-[10.5px] leading-4`}>
            {hint("K")}
          </kbd>
        </button>

        <div className="kairos-scroll-area -mx-3.5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-3.5">
          {railGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <span className={`${RAIL_LABEL} px-3 pb-1.5 text-[10.5px] font-medium tracking-[0.18em] whitespace-nowrap text-tui-ink3 uppercase`}>
                {group.label}
              </span>
              {group.items.map((item) => (
                <RailLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  count={item.count}
                  active={item.href === "/orgs" ? pathname === "/orgs" : isItemActive(item.href)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="mt-3 flex shrink-0 flex-col gap-0.5 border-t border-tui-ink/8 pt-3">
          <RailButton onClick={openAI} icon={Sparkles} label="Kairos AI" hint={hint("J")} />
          <RailLink
            href={settingsItem.href}
            icon={settingsItem.icon}
            label={settingsItem.label}
            active={pathname === "/settings"}
          />
          {user ? (
            <div className="mt-1.5 flex h-11 items-center gap-2.5 px-1.5 whitespace-nowrap" title={user.name ?? user.email ?? undefined}>
              {avatarSrc ? (
                <Image
                  src={avatarSrc}
                  alt=""
                  width={30}
                  height={30}
                  unoptimized
                  className="h-[30px] w-[30px] shrink-0 rounded-full border border-tui-ink/12 object-cover"
                />
              ) : (
                <span
                  style={avatarGradientStyle(user.id ?? user.email ?? user.name)}
                  className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full font-display text-[12px] font-semibold text-white"
                  aria-hidden="true"
                >
                  {initialsOf(user.name ?? user.email)}
                </span>
              )}
              <span className={`${RAIL_LABEL} flex min-w-0 flex-col gap-px`}>
                <span className="truncate text-[13px] font-medium text-tui-ink">{user.name ?? user.email}</span>
                {user.name && user.email ? (
                  <span className="truncate text-[11.5px] text-tui-ink3">{user.email}</span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
