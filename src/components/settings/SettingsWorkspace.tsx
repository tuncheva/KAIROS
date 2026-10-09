"use client";

/**
 * /settings as its own quiet space.
 *
 * Settings opens *over* the app rather than as another page inside it: no app
 * rail, no top bar, a back link and Esc to return. On the left, the account and
 * an index of every section; on the right, one reading column that holds all of
 * them, separated by hairlines and whitespace rather than cards. The index
 * follows the scroll, and picking an entry glides the column to it.
 *
 * Every section is mounted, because it is one document. That costs the queries
 * of all ten on open — tRPC batches them into a handful of requests — and buys
 * scrolling from Profile to Developer without a navigation. The section code is
 * still split per section, so it arrives in parallel rather than as one chunk.
 *
 * `?section=` still deep-links: the column is pinned to that section while the
 * sections above it finish loading (their height changes as data arrives), and
 * the URL is rewritten underneath as you scroll so a reload lands where you were.
 *
 * Two things sit above the sections: the account check, one line under the
 * title that expands into the checks behind it, and Activity, a drawer listing
 * what you changed during this visit.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { replaceUrlSilently } from "~/lib/historyUrl";
import { api } from "~/trpc/react";
import {
  ArrowLeft,
  ChevronRight,
  History,
  LightIcons,
  Search,
  X,
} from "~/components/ui/icons";

import { SECTION_ICON } from "./sectionIcons";
import { HealthSkeleton } from "./SettingsSkeleton";
import {
  FlaggedSectionsContext,
  SectionMatchCollector,
  SettingsFilterProvider,
  SettingsSaveProvider,
  SettingsSectionScope,
  useSettingsSave,
  type SettingsActivityEntry,
} from "./ledger/Ledger";
import {
  SECTION_GROUP,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./sections";

const ProfileSettingsClient = dynamic(() =>
  import("./ProfileSettingsClient").then((m) => m.ProfileSettingsClient),
);
const WorkspaceSettingsClient = dynamic(() =>
  import("./WorkspaceSettingsClient").then((m) => m.WorkspaceSettingsClient),
);
const NotificationSettingsClient = dynamic(() =>
  import("./NotificationSettingsClient").then((m) => m.NotificationSettingsClient),
);
const PrivacySettingsClient = dynamic(() =>
  import("./PrivacySettingsClient").then((m) => m.PrivacySettingsClient),
);
const SecuritySettingsClient = dynamic(() =>
  import("./SecuritySettingsClient").then((m) => m.SecuritySettingsClient),
);
const LanguageSettingsClient = dynamic(() =>
  import("./LanguageSettingsClient").then((m) => m.LanguageSettingsClient),
);
const AppearanceSettings = dynamic(() =>
  import("./AppearanceSettings").then((m) => m.AppearanceSettings),
);
const AiSettingsClient = dynamic(() =>
  import("./AiSettingsClient").then((m) => m.AiSettingsClient),
);
const DeveloperSettingsClient = dynamic(() =>
  import("./DeveloperSettingsClient").then((m) => m.DeveloperSettingsClient),
);
const BillingSettingsClient = dynamic(() =>
  import("./BillingSettingsClient").then((m) => m.BillingSettingsClient),
);

type Translator = (key: string, values?: Record<string, unknown>) => string;


/** How far below the top of the column a section counts as "the one you're in". */
const SPY_OFFSET = 120;
/** Where a section's top lands after a jump: just under the translucent bar. */
const LAND_OFFSET = 60;

interface Props {
  activeSection: SettingsSectionId;
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    bio?: string | null;
  };
}

export function SettingsWorkspace(props: Props) {
  return (
    <SettingsSaveProvider>
      <SettingsShell {...props} />
    </SettingsSaveProvider>
  );
}

function SettingsShell({ activeSection, user }: Props) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings");
  const router = useRouter();

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [spy, setSpy] = useState<SettingsSectionId>(activeSection);
  const [scrolled, setScrolled] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const docRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  const gliding = useRef(false);
  /** A section the column is held on while content above it settles. */
  const pinned = useRef<SettingsSectionId | null>(null);

  // Debounced: filtering re-renders every mounted section. One keystroke should
  // not do that.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery), 200);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const filtering = query.trim().length > 0;
  const totalMatches = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts],
  );

  const health = useAccountHealth();

  // Results start at the top; staying wherever you were reading would show
  // the middle of whatever happened to match.
  useEffect(() => {
    if (docRef.current) docRef.current.scrollTop = 0;
  }, [query]);

  // ---- scrolling -----------------------------------------------------------

  const offsetOf = useCallback((el: Element) => {
    const doc = docRef.current;
    if (!doc) return 0;
    return el.getBoundingClientRect().top - doc.getBoundingClientRect().top + doc.scrollTop;
  }, []);

  const glide = useCallback((target: number, onDone?: () => void) => {
    const doc = docRef.current;
    if (!doc) return;
    cancelAnimationFrame(raf.current);
    const from = doc.scrollTop;
    const to = Math.max(0, Math.min(target, doc.scrollHeight - doc.clientHeight));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || Math.abs(to - from) < 2) {
      doc.scrollTop = to;
      onDone?.();
      return;
    }
    gliding.current = true;
    const t0 = performance.now();
    const duration = 380;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      doc.scrollTop = from + (to - from) * eased;
      if (k < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        gliding.current = false;
        onDone?.();
      }
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // The URL follows the section you're reading, so a reload lands there.
  const spyRef = useRef(spy);
  const markSection = useCallback((id: SettingsSectionId) => {
    if (spyRef.current === id) return;
    spyRef.current = id;
    setSpy(id);
    replaceUrlSilently(`/settings?section=${id}`);
  }, []);

  const goToSection = useCallback(
    (id: SettingsSectionId, rowId?: string) => {
      const run = () => {
        const doc = docRef.current;
        const section = doc?.querySelector(`[data-sec="${id}"]`);
        if (!doc || !section) return;
        const row = rowId ? section.querySelector(`[data-row="${rowId}"]`) : null;
        pinned.current = null;
        markSection(id);
        const target = row ? offsetOf(row) - 90 : offsetOf(section) - LAND_OFFSET;
        glide(target, () => {
          if (!row) return;
          row.classList.remove("settings-row-flash");
          // Restart the animation if the same row is flashed twice in a row.
          void (row as HTMLElement).offsetWidth;
          row.classList.add("settings-row-flash");
        });
      };
      if (rawQuery || query) {
        setRawQuery("");
        setQuery("");
        // Let the hidden sections come back before measuring.
        requestAnimationFrame(() => requestAnimationFrame(run));
      } else {
        run();
      }
    },
    [glide, markSection, offsetOf, query, rawQuery],
  );

  const onDocScroll = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    setScrolled(doc.scrollTop > 24);
    // While filtering, the sidebar shows match counts rather than a position.
    if (gliding.current || pinned.current || filtering) return;
    let current: SettingsSectionId | null = null;
    doc.querySelectorAll<HTMLElement>("[data-sec]").forEach((el) => {
      if (el.offsetParent === null) return; // hidden by the filter
      if (offsetOf(el) <= doc.scrollTop + SPY_OFFSET) {
        current = el.dataset.sec as SettingsSectionId;
      }
    });
    if (current) markSection(current);
  }, [filtering, markSection, offsetOf]);

  /*
   * Deep link. Jump straight to the requested section, then keep it pinned
   * while the sections above it load and change height — otherwise the column
   * lands on Billing and drifts into Workspace as Workspace's members arrive.
   * The pin lets go the moment you scroll yourself, or after a few seconds.
   */
  const pinTo = useCallback(
    (id: SettingsSectionId) => {
      const doc = docRef.current;
      const column = columnRef.current;
      if (!doc || !column) return;
      if (id === SETTINGS_SECTIONS[0]) {
        doc.scrollTop = 0;
        return;
      }
      pinned.current = id;
      markSection(id);

      const align = () => {
        if (pinned.current !== id) return;
        const el = doc.querySelector(`[data-sec="${id}"]`);
        if (el) doc.scrollTop = offsetOf(el) - LAND_OFFSET;
      };
      align();

      const observer = new ResizeObserver(align);
      observer.observe(column);
      const release = () => {
        if (pinned.current === id) pinned.current = null;
        observer.disconnect();
        doc.removeEventListener("wheel", release);
        doc.removeEventListener("touchstart", release);
        doc.removeEventListener("keydown", release);
        doc.removeEventListener("pointerdown", release);
      };
      doc.addEventListener("wheel", release, { passive: true });
      doc.addEventListener("touchstart", release, { passive: true });
      doc.addEventListener("keydown", release);
      doc.addEventListener("pointerdown", release);
      const timer = setTimeout(release, 4000);
      return () => {
        clearTimeout(timer);
        release();
      };
    },
    [markSection, offsetOf],
  );

  // On open, and whenever a real navigation (the command palette, Back into a
  // deep link) names a different section.
  useLayoutEffect(() => pinTo(activeSection), [activeSection, pinTo]);

  // ---- leaving -------------------------------------------------------------

  const leave = useCallback(() => {
    let cameFromApp = window.history.length > 1;
    if (cameFromApp && document.referrer) {
      try {
        cameFromApp = new URL(document.referrer).origin === window.location.origin;
      } catch {
        cameFromApp = false;
      }
    }
    if (cameFromApp) router.back();
    else router.push("/dashboard");
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // A dialog opened from a section owns its own Esc.
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      if (activityOpen) setActivityOpen(false);
      else leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activityOpen, leave]);

  // ---- render --------------------------------------------------------------

  const flagged = useMemo(
    () => new Set(health.checks.filter((c) => !c.ok).map((c) => c.section)),
    [health.checks],
  );

  const currentTitle = filtering
    ? t("elegant.resultsFor", { query: query.trim() })
    : t(`nav.${spy}`);

  const search = (
    <label className="flex h-[34px] items-center gap-2.5 rounded-[7px] bg-fg-primary/5 pl-3 pr-2 focus-within:bg-fg-primary/[0.07]">
      <Search size={13} className="flex-none text-fg-tertiary" />
      <input
        value={rawQuery}
        onChange={(e) => setRawQuery(e.target.value)}
        placeholder={t("filterPlaceholder")}
        aria-label={t("filterPlaceholder")}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-settings-desc text-fg-primary outline-none placeholder:text-fg-tertiary"
      />
      {rawQuery ? (
        <button
          type="button"
          onClick={() => {
            setRawQuery("");
            setQuery("");
          }}
          aria-label={t("elegant.clearSearch")}
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-fg-tertiary hover:text-fg-primary"
        >
          <X size={10} />
        </button>
      ) : null}
    </label>
  );

  return (
    <SettingsFilterProvider query={query}>
      <FlaggedSectionsContext.Provider value={flagged}>
        <LightIcons>
          <div className="settings-elegant fixed inset-0 z-[55] flex bg-bg-primary text-fg-primary">
            {/* ---------------------------------------------------------- index */}
            <aside className="hidden w-[300px] flex-none flex-col border-r border-border-light bg-settings-side lg:flex">
              <div className="px-7 pt-[26px]">
                <button
                  type="button"
                  onClick={leave}
                  className="-ml-1.5 flex h-[30px] cursor-pointer items-center gap-2.5 rounded-[6px] pl-1.5 pr-2.5 text-settings-desc text-fg-secondary transition-colors hover:bg-fg-primary/5 hover:text-fg-primary"
                >
                  <ArrowLeft size={14} />
                  {t("elegant.back")}
                </button>
              </div>

              <div className="flex items-center gap-3.5 px-7 pb-[26px] pt-[34px]">
                <Avatar user={user} size={44} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-settings-row font-medium">
                    {user.name?.trim() ? user.name : user.email}
                  </span>
                  {user.name && user.email ? (
                    <span className="truncate text-settings-small text-fg-tertiary">{user.email}</span>
                  ) : null}
                </div>
              </div>

              <div className="px-5 pb-3.5">{search}</div>

              <nav
                aria-label={t("title")}
                className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-3 pb-3 pt-1.5"
              >
                {SETTINGS_GROUPS.map((group) => (
                  <div key={group} className="flex flex-col gap-px">
                    <span className="px-4 pb-2 text-settings-eyebrow font-medium uppercase tracking-[0.14em] text-fg-tertiary">
                      {t(`elegant.group.${group}`)}
                    </span>
                    {SETTINGS_SECTIONS.filter((id) => SECTION_GROUP[id] === group).map((id) => {
                      const Icon = SECTION_ICON[id];
                      const on = !filtering && spy === id;
                      const count = counts[id] ?? 0;
                      const dim = filtering && count === 0;
                      return (
                        <a
                          key={id}
                          href={`/settings?section=${id}`}
                          aria-current={on ? "location" : undefined}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                            e.preventDefault();
                            goToSection(id);
                          }}
                          className={`flex h-9 items-center gap-[7px] rounded-[7px] pl-3 pr-3.5 transition-colors duration-[250ms] hover:bg-fg-primary/5 hover:text-fg-primary ${
                            on ? "bg-fg-primary/5 text-fg-primary" : "text-fg-secondary"
                          } ${dim ? "opacity-35" : ""}`}
                        >
                          {/* The section's medallion in miniature: the ring only
                              appears on the section you are reading. */}
                          <span
                            aria-hidden
                            className={`flex h-6 w-6 flex-none items-center justify-center rounded-full transition-[background-color,box-shadow] duration-[250ms] ${
                              on
                                ? "bg-bg-elevated text-accent-primary shadow-[0_0_0_1px_rgb(var(--accent-primary)/0.45)]"
                                : "text-fg-tertiary"
                            }`}
                          >
                            <Icon size={15} />
                          </span>
                          <span className={`flex-1 text-settings-body ${on ? "font-semibold" : "font-medium"}`}>
                            {t(`nav.${id}`)}
                          </span>
                          {filtering ? (
                            <span
                              className={`text-settings-micro tabular-nums ${
                                count ? "text-accent-primary" : "text-fg-tertiary"
                              }`}
                            >
                              {count}
                            </span>
                          ) : flagged.has(id) ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                          ) : null}
                        </a>
                      );
                    })}
                  </div>
                ))}
              </nav>

              <SaveFooter />
            </aside>

            {/* --------------------------------------------------------- column */}
            <div className="relative flex min-w-0 flex-1 flex-col">
              <div
                className={`absolute inset-x-0 top-0 z-[4] flex h-16 items-center gap-3 border-b tui-screen pl-4 pr-4 transition-colors duration-300 sm:pr-7 lg:pl-14 ${
                  scrolled ? "border-border-light" : "border-transparent"
                }`}
              >
                <button
                  type="button"
                  onClick={leave}
                  aria-label={t("elegant.back")}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] text-fg-secondary hover:bg-fg-primary/5 hover:text-fg-primary lg:hidden"
                >
                  <ArrowLeft size={15} />
                </button>
                <div
                  className={`flex min-w-0 items-center gap-3 text-settings-desc transition-opacity duration-300 ${
                    scrolled || filtering ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <span className="text-fg-tertiary">{t("title")}</span>
                  <span className="text-fg-quaternary">/</span>
                  <span className="truncate text-fg-primary">{currentTitle}</span>
                </div>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setActivityOpen((open) => !open)}
                  aria-expanded={activityOpen}
                  aria-controls="settings-activity"
                  className={`flex h-8 cursor-pointer items-center gap-2 rounded-[7px] px-3 text-settings-small font-medium text-fg-secondary transition-colors hover:bg-fg-primary/5 ${
                    activityOpen ? "bg-fg-primary/5" : ""
                  }`}
                >
                  <History size={14} />
                  {t("elegant.activity")}
                  <ActivityCount />
                </button>
                <button
                  type="button"
                  onClick={leave}
                  title={t("elegant.close")}
                  aria-label={t("elegant.close")}
                  className="hidden h-8 cursor-pointer items-center gap-2 rounded-[7px] pl-2.5 pr-2 text-settings-meta text-fg-tertiary transition-colors hover:bg-fg-primary/5 hover:text-fg-primary sm:flex"
                >
                  <kbd className="rounded-[4px] border border-border-medium px-[5px] py-px font-mono text-settings-eyebrow leading-[14px]">
                    esc
                  </kbd>
                  <X size={14} />
                </button>
              </div>

              <div
                ref={docRef}
                onScroll={onDocScroll}
                tabIndex={-1}
                className="tui-screen relative min-h-0 flex-1 overflow-y-auto outline-none"
              >
                <div
                  ref={columnRef}
                  className="min-h-full w-full px-5 pb-[220px] pt-24 sm:px-10 lg:px-14 lg:pt-28"
                >
                  {/* On a phone the index has nowhere to live, so the search and
                      a strip of sections sit at the top of the column instead. */}
                  <div className="mb-8 flex flex-col gap-3 lg:hidden">
                    {search}
                    <div className="scrollbar-hide -mx-5 flex gap-1 overflow-x-auto px-5 sm:-mx-10 sm:px-10">
                      {SETTINGS_SECTIONS.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => goToSection(id)}
                          className={`h-8 flex-none cursor-pointer whitespace-nowrap rounded-[7px] px-3 text-settings-small font-medium ${
                            !filtering && spy === id
                              ? "bg-fg-primary/5 text-fg-primary"
                              : "text-fg-secondary"
                          } ${filtering && !(counts[id] ?? 0) ? "opacity-35" : ""}`}
                        >
                          {t(`nav.${id}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {!filtering ? (
                    <div className="settings-rise flex flex-col gap-2.5 pb-9">
                      <h1 className="settings-serif m-0 text-settings-display font-light">
                        {t("title")}
                      </h1>
                      <p className="m-0 text-settings-lead text-fg-secondary">
                        {t("elegant.intro")}
                      </p>
                      <HealthSummary
                        health={health}
                        onReview={(check) => goToSection(check.section, check.row)}
                      />
                    </div>
                  ) : null}

                  <SectionMatchCollector onChange={setCounts}>
                    {SETTINGS_SECTIONS.map((id) => (
                      <section
                        key={id}
                        data-sec={id}
                        aria-label={t(`nav.${id}`)}
                        className={`border-t border-border-light pb-2 pt-[52px] ${
                          filtering && !(counts[id] ?? 0) ? "hidden" : ""
                        }`}
                      >
                        <SettingsSectionScope sectionId={id}>
                          <SectionBody id={id} user={user} />
                        </SettingsSectionScope>
                      </section>
                    ))}
                  </SectionMatchCollector>

                  {filtering && totalMatches === 0 ? (
                    <p className="py-10 text-settings-lead text-fg-secondary">{t("filterEmpty")}</p>
                  ) : null}
                </div>
              </div>

              {activityOpen ? (
                <ActivityDrawer
                  user={user}
                  onPick={(section) => {
                    if (section) goToSection(section);
                  }}
                />
              ) : null}
            </div>
          </div>
        </LightIcons>
      </FlaggedSectionsContext.Provider>
    </SettingsFilterProvider>
  );
}

function SectionBody({ id, user }: { id: SettingsSectionId; user: Props["user"] }) {
  switch (id) {
    case "profile":
      return <ProfileSettingsClient user={user} />;
    case "workspace":
      return <WorkspaceSettingsClient />;
    case "notifications":
      return <NotificationSettingsClient />;
    case "privacy":
      return <PrivacySettingsClient />;
    case "security":
      return <SecuritySettingsClient />;
    case "language":
      return <LanguageSettingsClient />;
    case "appearance":
      return <AppearanceSettings />;
    case "ai":
      return <AiSettingsClient />;
    case "billing":
      return <BillingSettingsClient />;
    case "developer":
      return <DeveloperSettingsClient />;
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function initialsOf(user: Props["user"]): string {
  // `||`, not `??`: an empty name falls through to the e-mail too.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const source = user.name?.trim() || user.email || "?";
  return (
    source
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function Avatar({ user, size }: { user: Props["user"]; size: number }) {
  if (user.image) {
    return (
      <Image
        src={user.image}
        alt=""
        width={size}
        height={size}
        className="flex-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="settings-serif flex flex-none items-center justify-center rounded-full bg-fg-primary/5 font-light"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initialsOf(user)}
    </span>
  );
}

function useClock() {
  const locale = useLocale();
  return useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
}

/** "All changes saved · 14:02", at the foot of the index. */
function SaveFooter() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings");
  const { state, savedAt } = useSettingsSave();
  const clock = useClock();

  const label =
    state === "saving"
      ? t("saveSaving")
      : state === "error"
        ? t("saveFailed")
        : savedAt
          ? t("elegant.savedAt", { time: clock.format(savedAt) })
          : t("elegant.saveIdle");

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-t border-border-light px-7 pb-[22px] pt-4 text-settings-meta text-fg-tertiary"
    >
      <span
        className={`h-1.5 w-1.5 flex-none rounded-full ${
          state === "saving"
            ? "settings-pulse bg-accent-primary"
            : state === "error"
              ? "bg-error"
              : savedAt
                ? "bg-success"
                : "bg-border-strong"
        }`}
      />
      <span className={state === "error" ? "text-error" : ""}>{label}</span>
    </div>
  );
}

function ActivityCount() {
  const { activity } = useSettingsSave();
  if (!activity.length) return null;
  return <span className="text-settings-micro tabular-nums text-fg-tertiary">{activity.length}</span>;
}

// ---- account check ---------------------------------------------------------

interface HealthCheck {
  key: string;
  ok: boolean;
  label: string;
  section: SettingsSectionId;
  row: string;
}

interface AccountHealth {
  loaded: boolean;
  /** The query failed; the summary stays out of the way rather than spin. */
  failed: boolean;
  checks: HealthCheck[];
}

/**
 * The account check: the handful of things that decide whether this account
 * can be recovered and can't be walked into. Read from the same query the
 * Security section uses, so it costs nothing extra and moves the moment one of
 * them is fixed below.
 */
function useAccountHealth(): AccountHealth {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.elegant.health");
  const { data, isError } = api.settings.get.useQuery(undefined, { staleTime: 30_000 });

  return useMemo(() => {
    if (!data) return { loaded: false, failed: isError, checks: [] };
    const check = (key: string, ok: boolean, row: string): HealthCheck => ({
      key,
      ok,
      label: t(ok ? `${key}Ok` : `${key}Bad`),
      section: "security",
      row,
    });
    return {
      loaded: true,
      failed: false,
      checks: [
        check("email", !!data.emailVerified, "emailStatus"),
        check("twoFactor", !!data.twoFactorEnabled, "twoFactorStatus"),
        check("pin", !!data.hasResetPin, "pinStatus"),
      ],
    };
  }, [data, isError, t]);
}

function HealthSummary({
  health,
  onReview,
}: {
  health: AccountHealth;
  onReview: (check: HealthCheck) => void;
}) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.elegant.health");
  const [open, setOpen] = useState(false);

  if (health.failed) return null;
  if (!health.loaded) {
    return <HealthSkeleton />;
  }

  const total = health.checks.length;
  const score = health.checks.filter((c) => c.ok).length;
  const allGood = score === total;
  const remaining = total - score;

  return (
    <div className="mt-[22px] flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex cursor-pointer items-center gap-4 rounded-[10px] border px-[18px] py-4 text-left transition-colors hover:bg-fg-primary/5 ${
          allGood ? "border-border-medium" : "border-warning/45"
        }`}
      >
        <span
          className={`settings-serif text-settings-stat font-light tabular-nums ${
            allGood ? "text-success" : "text-fg-primary"
          }`}
        >
          {score}
          <span className="text-[0.56em] text-fg-tertiary">/{total}</span>
        </span>
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="text-settings-row font-medium">
            {allGood ? t("headlineOk") : t("headlineBad", { count: remaining })}
          </span>
          <span className="flex max-w-[220px] gap-[3px]">
            {health.checks.map((c) => (
              <span
                key={c.key}
                className={`h-[3px] flex-1 rounded-[2px] transition-colors duration-300 ${
                  c.ok ? "bg-success" : "bg-warning"
                }`}
              />
            ))}
          </span>
        </span>
        <span className="hidden text-settings-small text-fg-tertiary sm:inline">
          {open ? t("hide") : allGood ? t("details") : t("review")}
        </span>
        <ChevronRight
          size={12}
          className={`flex-none text-fg-tertiary transition-transform duration-[250ms] ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>

      {open ? (
        <div className="settings-rise flex flex-col px-[18px] pt-1">
          {health.checks.map((c, i) => (
            <div
              key={c.key}
              className={`flex min-h-10 items-center gap-3 text-settings-body ${
                i ? "border-t border-border-light" : ""
              }`}
            >
              <span
                className={`h-1.5 w-1.5 flex-none rounded-full ${c.ok ? "bg-success" : "bg-warning"}`}
              />
              <span className={`flex-1 ${c.ok ? "text-fg-secondary" : "text-fg-primary"}`}>
                {c.label}
              </span>
              {!c.ok ? (
                <button
                  type="button"
                  onClick={() => onReview(c)}
                  className="cursor-pointer text-settings-small font-medium text-accent-primary hover:opacity-75"
                >
                  {t("reviewOne")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---- activity --------------------------------------------------------------

function ActivityDrawer({
  user,
  onPick,
}: {
  user: Props["user"];
  onPick: (section: SettingsSectionId | null) => void;
}) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings");
  const { activity } = useSettingsSave();
  const clock = useClock();
  const initial = initialsOf(user)[0];

  const describe = (entry: SettingsActivityEntry) => {
    const section =
      entry.section && (SETTINGS_SECTIONS as readonly string[]).includes(entry.section)
        ? t(`nav.${entry.section}`)
        : null;
    if (!entry.ok) {
      return section
        ? t("elegant.activityFailed", { section })
        : t("elegant.activityFailedGeneric");
    }
    if (entry.label) return entry.label;
    return section
      ? t("elegant.activityChanged", { section })
      : t("elegant.activityChangedGeneric");
  };

  return (
    <aside
      id="settings-activity"
      aria-label={t("elegant.activity")}
      className="settings-slide absolute bottom-0 right-0 top-16 z-[5] flex w-full flex-col border-l border-border-light bg-settings-side shadow-[-30px_0_60px_-30px_rgb(0_0_0/0.5)] sm:w-[380px]"
    >
      <div className="flex flex-col gap-3 border-b border-border-light px-6 pb-3.5 pt-[22px]">
        <span className="settings-serif text-settings-heading">{t("elegant.activity")}</span>
        <span className="text-settings-small text-fg-tertiary">
          {t("elegant.activityHint")}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-2">
        {activity.length === 0 ? (
          <span className="block px-3 py-6 text-settings-desc text-fg-tertiary">
            {t("elegant.activityEmpty")}
          </span>
        ) : (
          activity.map((entry) => {
            const section =
              entry.section && (SETTINGS_SECTIONS as readonly string[]).includes(entry.section)
                ? (entry.section as SettingsSectionId)
                : null;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onPick(section)}
                disabled={!section}
                className="flex w-full cursor-pointer gap-3 rounded-sm px-3 py-[11px] text-left hover:bg-fg-primary/5 disabled:cursor-default"
              >
                <span className="settings-serif flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-fg-primary/5 text-settings-small text-fg-secondary">
                  {initial}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span
                    className={`text-settings-desc ${
                      entry.ok ? "text-fg-secondary" : "text-error"
                    }`}
                  >
                    <b className="font-semibold text-fg-primary">{t("elegant.activityYou")}</b>{" "}
                    {describe(entry)}
                  </span>
                  <span className="flex items-center gap-2 text-settings-micro text-fg-tertiary">
                    <span className="tabular-nums">{clock.format(entry.at)}</span>
                    {section ? <span>· {t(`nav.${section}`)}</span> : null}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="border-t border-border-light px-6 pb-4 pt-3 text-settings-micro text-fg-tertiary">
        {t("elegant.activityFooter")}
      </div>
    </aside>
  );
}
