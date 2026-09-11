"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "~/components/ui/icons";
import { replaceUrlSilently } from "~/lib/historyUrl";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { CalendarAgenda } from "./CalendarAgenda";
import { CalendarDayPeek } from "./CalendarDayPeek";
import { CalendarDrawer, type DrawerState } from "./CalendarDrawer";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { CalendarTimeGrid } from "./CalendarTimeGrid";
import { useDismissOnOutside, useFocusTrap } from "./useCalendarA11y";
import {
  ITEM_KINDS,
  KIND_GLYPH,
  KIND_LABEL_KEYS,
  KIND_CHIP_TONE,
  MAX_RANGE_DAYS,
  PRIORITY_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  addDays,
  addMonths,
  dayKey,
  endOfDayLocal,
  fromYmd,
  hourWindow,
  isoWeek,
  matchesFilters,
  priorityTone,
  rangeBounds,
  startOfDayLocal,
  toCalendarItems,
  toHm,
  toYmd,
  visibleDays,
  type CalendarItem,
  type CalendarKind,
  type Layout,
  type ViewMode,
} from "./calendarModel";

const WEEKDAY_KEYS = [
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
  "weekdaySun",
] as const;

const VIEWS: ViewMode[] = ["day", "week", "month", "range"];
const VIEW_LABEL_KEYS: Record<ViewMode, string> = {
  day: "day",
  week: "week",
  month: "month",
  range: "range",
};

const SMALL_CHIP =
  "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition-colors";
const IDLE_CHIP = "border-border-medium text-fg-tertiary hover:bg-bg-secondary";
const MICRO_LABEL = "text-[11px] uppercase tracking-[0.12em] text-fg-tertiary";
const BAR_BTN =
  "flex h-[30px] items-center gap-1.5 rounded-lg border border-border-medium px-2.5 text-xs font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary";
const DATE_INPUT =
  "h-[30px] rounded-md border border-border-medium bg-bg-surface px-2 text-[11px] tabular-nums text-fg-primary outline-none transition-colors focus:border-accent-primary/60";

/**
 * Every date on this page is read off the client clock: which week is "this"
 * week, which cell is today, what the range inputs are pre-filled with. The
 * server renders in its own timezone and at its own instant, so rendering the
 * grid during SSR guarantees a hydration mismatch on the day numbers, the
 * input values and the period title. Hold a skeleton until the browser clock
 * is known, then build the calendar from it — client-side only, once.
 */
export function CalendarClient() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(startOfDayLocal(new Date())), []);

  if (!today) return <CalendarSkeleton />;
  return <CalendarWorkspace today={today} />;
}

function CalendarSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-5 sm:px-6 md:px-8">
      <div className="h-[46px] w-full animate-pulse rounded-lg bg-bg-secondary" />
      <div className="h-5 w-64 animate-pulse rounded bg-bg-secondary" />
      <div className="min-h-0 flex-1 rounded-xl border border-border-light bg-bg-elevated" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  URL state                                                         */
/*                                                                    */
/*  `view` and `date` were already here. Everything that narrows what */
/*  you see was not, so a shared link silently dropped the lens the   */
/*  sender was looking through and Back could not undo a filter.      */
/* ------------------------------------------------------------------ */

function params() {
  return new URLSearchParams(window.location.search);
}

function readView(): ViewMode {
  const value = params().get("view");
  return VIEWS.includes(value as ViewMode) ? (value as ViewMode) : "week";
}

/** `null` when absent or unparseable, so the caller falls back to today. */
function readDate(): Date | null {
  const value = params().get("date");
  return value ? fromYmd(value) : null;
}

/** A comma list, intersected with what is actually valid. Absent means "all",
 *  which is what an unfiltered calendar shows. */
function readSet<T extends string>(key: string, all: readonly T[]): Set<T> {
  const raw = params().get(key);
  if (raw === null) return new Set(all);
  const picked = raw.split(",").filter((v): v is T => (all as readonly string[]).includes(v));
  return new Set(picked);
}

function CalendarWorkspace({ today }: { today: Date }) {
  const t = useTranslations("calendar.filters");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : "en-US";
  const fmt = useCallback(
    (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString(dateLocale, opts),
    [dateLocale],
  );

  const [view, setView] = useState<ViewMode>(() => readView());
  const [anchor, setAnchor] = useState<Date>(() => readDate() ?? today);
  const [rangeText, setRangeText] = useState(() => {
    const from = params().get("from");
    const to = params().get("to");
    const seed = readDate() ?? today;
    return {
      from: from ?? toYmd(seed),
      to: to ?? toYmd(addDays(seed, 6)),
    };
  });

  const [query, setQuery] = useState(() => params().get("q") ?? "");
  const [kinds, setKinds] = useState<Set<CalendarKind>>(() => readSet("kinds", ITEM_KINDS));
  const [statuses, setStatuses] = useState<Set<string>>(() => readSet("status", TASK_STATUSES));
  const [priorities, setPriorities] = useState<Set<string>>(() => readSet("prio", TASK_PRIORITIES));

  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [peekDate, setPeekDate] = useState<Date | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);

  /* Agenda is the phone default: a week grid at 375px gives each day 53px,
     which is why the grids carried a 760px floor and panned the whole
     calendar sideways. Manual override wins once the user has expressed a
     preference, so resizing does not undo their choice. */
  const [narrow, setNarrow] = useState(false);
  const [layoutOverride, setLayoutOverride] = useState<Layout | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const layout: Layout = layoutOverride ?? (narrow ? "agenda" : "grid");

  // Drives the red now-line, so it has to keep up with the wall clock.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const filterRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  useFocusTrap(filterRef, filtersOpen, closeFilters);
  useDismissOnOutside(filterRef, filtersOpen, closeFilters);

  const shortcutsRef = useRef<HTMLDivElement>(null);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  useFocusTrap(shortcutsRef, shortcutsOpen, closeShortcuts);

  /* ---------------- period ---------------- */

  const bounds = useMemo(() => rangeBounds(rangeText.from, rangeText.to), [rangeText]);

  const days = useMemo(() => visibleDays(view, anchor, bounds), [view, anchor, bounds]);
  const periodFrom = startOfDayLocal(days[0]!);
  const periodTo = endOfDayLocal(days[days.length - 1]!);

  const { data, isLoading, isError, refetch } = api.calendar.getForRange.useQuery(
    { from: periodFrom, to: periodTo },
    { staleTime: 30_000 },
  );

  const utils = api.useUtils();
  const refreshCalendar = useCallback(() => {
    void utils.calendar.getForRange.invalidate();
  }, [utils]);

  /* ---------------- items ---------------- */

  const untitledNote = t("untitledNote");
  const allItems = useMemo(() => toCalendarItems(data, untitledNote), [data, untitledNote]);

  const visibleItems = useMemo(
    () => allItems.filter((item) => matchesFilters(item, { query, kinds, statuses, priorities })),
    [allItems, kinds, statuses, priorities, query],
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of visibleItems) {
      const key = dayKey(item.date);
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [visibleItems]);

  const kindCounts = useMemo(() => {
    const counts: Record<CalendarKind, number> = { task: 0, event: 0, note: 0, external: 0 };
    for (const item of allItems) counts[item.kind] += 1;
    return counts;
  }, [allItems]);

  const hours = useMemo(() => hourWindow(visibleItems), [visibleItems]);

  /* ---------------- navigation ---------------- */

  const step = useCallback(
    (direction: -1 | 1) => {
      if (view === "range") {
        // A range steps by its own length, so "next" means the next block of
        // the same size rather than an arbitrary week.
        if (!bounds) return;
        const span =
          Math.round((startOfDayLocal(bounds.to).getTime() - startOfDayLocal(bounds.from).getTime()) / 86_400_000) + 1;
        setRangeText({
          from: toYmd(addDays(bounds.from, direction * span)),
          to: toYmd(addDays(startOfDayLocal(bounds.to), direction * span)),
        });
        return;
      }
      setAnchor((current) => {
        if (view === "month") return addMonths(current, direction);
        return addDays(current, direction * (view === "week" ? 7 : 1));
      });
    },
    [bounds, view],
  );

  const goToToday = useCallback(() => {
    setAnchor(today);
    if (view === "range") {
      setRangeText({ from: toYmd(today), to: toYmd(addDays(today, 6)) });
    }
  }, [today, view]);

  const switchView = useCallback(
    (next: ViewMode) => {
      setView(next);
      // Entering the range view seeds it from where you already were, so the
      // period never jumps somewhere unrelated.
      if (next === "range") {
        setRangeText((current) => current ?? { from: toYmd(anchor), to: toYmd(addDays(anchor, 6)) });
      }
    },
    [anchor],
  );

  /* Keep the roving cell inside the period after it changes, and land on today
     when the period contains it — which is where someone stepping to "this
     week" expects to be. */
  useEffect(() => {
    const todayIndex = days.findIndex((day) => day.getTime() === today.getTime());
    setFocusedIndex((current) => {
      if (todayIndex >= 0) return todayIndex;
      return Math.min(current, Math.max(0, days.length - 1));
    });
  }, [days, today]);

  /* `replaceState`, not a router push. The period and the filters are views of
     one page, so each arrow press should not become a history entry you have
     to walk back through — and routing would re-render the shell above for a
     change that is entirely local to this grid. Back still leaves the
     calendar, which is what the button appeared to promise and never did.

     `replaceUrlSilently` rather than `history.replaceState` directly: the
     App Router turns the latter into a fresh RSC request for the new URL, so
     this effect — which runs on every arrow press, filter toggle and debounced
     search keystroke — was refetching the route each time, skeleton and all. */
  useEffect(() => {
    const next = new URLSearchParams();
    next.set("view", view);
    next.set("date", toYmd(anchor));
    if (view === "range") {
      next.set("from", rangeText.from);
      next.set("to", rangeText.to);
    }
    // Only non-default filter state reaches the URL, so an unfiltered
    // calendar still has a short, shareable link.
    if (query.trim()) next.set("q", query);
    if (kinds.size !== ITEM_KINDS.length) next.set("kinds", [...kinds].join(","));
    if (statuses.size !== TASK_STATUSES.length) next.set("status", [...statuses].join(","));
    if (priorities.size !== TASK_PRIORITIES.length) next.set("prio", [...priorities].join(","));
    replaceUrlSilently(`?${next.toString()}`);
  }, [anchor, kinds, priorities, query, rangeText, statuses, view]);

  /* ---------------- labels ---------------- */

  const title = useMemo(() => {
    if (view === "month") return fmt(anchor, { month: "long", year: "numeric" });
    if (view === "day") return fmt(anchor, { weekday: "short", day: "numeric", month: "long" });

    const first = days[0]!;
    const last = days[days.length - 1]!;
    if (first.getTime() === last.getTime()) {
      return fmt(first, { weekday: "short", day: "numeric", month: "long" });
    }
    return first.getMonth() === last.getMonth()
      ? `${first.getDate()} – ${last.getDate()} ${fmt(first, { month: "long" })}`
      : `${first.getDate()} ${fmt(first, { month: "short" })} – ${last.getDate()} ${fmt(last, { month: "short" })}`;
  }, [anchor, days, fmt, view]);

  const weekdayLabels = WEEKDAY_KEYS.map((key) => t(key));
  const weekdayLongLabels = useMemo(
    () =>
      days.length >= 7
        ? Array.from({ length: 7 }, (_, i) => fmt(addDays(days[0]!, i), { weekday: "long" }))
        : weekdayLabels,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, fmt],
  );
  const weekdayLabel = (date: Date) => weekdayLabels[(date.getDay() + 6) % 7]!;

  const fullDate = useCallback(
    (date: Date) => fmt(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    [fmt],
  );

  const dayLabel = useCallback(
    (date: Date, count: number) => `${fullDate(date)}, ${t("itemsCount", { count })}`,
    [fullDate, t],
  );

  /** The one place an item's kind, title, time and state are spelled out in
   *  words — every chip, block and row uses it as its accessible name. */
  const describeItem = useCallback(
    (item: CalendarItem) => {
      const parts = [t(KIND_LABEL_KEYS[item.kind]), item.title];
      if (item.allDay) parts.push(t("allDay"));
      else if ((item.kind === "event" || item.kind === "external") && item.endsAt)
        parts.push(`${toHm(item.date)}–${toHm(item.endsAt)}`);
      else parts.push(toHm(item.date));

      if (item.kind === "task") {
        parts.push(t(STATUS_LABEL_KEYS[item.status] ?? "statusPending"));
        parts.push(t(PRIORITY_LABEL_KEYS[item.priority] ?? "priorityMedium"));
        if (item.projectTitle) parts.push(item.projectTitle);
      }
      if (item.kind === "note" && item.locked) parts.push(t("locked"));
      // The one kind nothing on this page can change. Said out loud, because a
      // sighted user infers it from the dimmed treatment and a screen-reader
      // user would otherwise reach the detail panel before finding out.
      if (item.kind === "external") parts.push(t("readOnlyItem"));
      return parts.join(", ");
    },
    [t],
  );

  const itemMeta = useCallback(
    (item: CalendarItem) => {
      if (item.kind === "task") {
        return [item.projectTitle, t(STATUS_LABEL_KEYS[item.status] ?? "statusPending")]
          .filter(Boolean)
          .join(" · ");
      }
      if (item.kind === "event") return t(KIND_LABEL_KEYS.event);
      if (item.kind === "external") {
        return [t(KIND_LABEL_KEYS.external), item.location].filter(Boolean).join(" · ");
      }
      return t(KIND_LABEL_KEYS.note);
    },
    [t],
  );

  /* ---------------- active filters ---------------- */

  const toggleIn = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  /** One token per thing that is hiding something, each able to undo itself.
   *  This replaced a silent count: "why is my calendar empty" is now answered
   *  and reversible in the same place. */
  const tokens = useMemo(() => {
    const out: { id: string; label: string; clear: () => void }[] = [];

    for (const kind of ITEM_KINDS) {
      if (!kinds.has(kind)) {
        out.push({
          id: `kind-${kind}`,
          label: t("hidingKind", { kind: t(KIND_LABEL_KEYS[kind]).toLowerCase() }),
          clear: () => setKinds((current) => new Set(current).add(kind)),
        });
      }
    }
    for (const status of TASK_STATUSES) {
      if (!statuses.has(status)) {
        out.push({
          id: `status-${status}`,
          label: t("hidingStatus", { status: t(STATUS_LABEL_KEYS[status]!).toLowerCase() }),
          clear: () => setStatuses((current) => new Set(current).add(status)),
        });
      }
    }
    for (const priority of TASK_PRIORITIES) {
      if (!priorities.has(priority)) {
        out.push({
          id: `prio-${priority}`,
          label: t("hidingPriority", { priority: t(PRIORITY_LABEL_KEYS[priority]!).toLowerCase() }),
          clear: () => setPriorities((current) => new Set(current).add(priority)),
        });
      }
    }
    if (query.trim()) {
      out.push({
        id: "query",
        label: t("matchingQuery", { query: query.trim() }),
        clear: () => setQuery(""),
      });
    }
    return out;
  }, [kinds, priorities, query, statuses, t]);

  const resetFilters = useCallback(() => {
    setKinds(new Set(ITEM_KINDS));
    setStatuses(new Set(TASK_STATUSES));
    setPriorities(new Set(TASK_PRIORITIES));
    setQuery("");
  }, []);

  /* ---------------- creation + selection ---------------- */

  const openNew = useCallback((date: Date) => {
    setPeekDate(null);
    setDrawer({ mode: "new", date });
  }, []);

  const openItem = useCallback((item: CalendarItem) => {
    setPeekDate(null);
    setDrawer({ mode: "detail", item });
  }, []);

  const focusedDay = days[Math.min(focusedIndex, days.length - 1)] ?? days[0]!;

  // The toolbar's New button has no cell to anchor to: prefer today when the
  // period on screen contains it, otherwise the day the grid is focused on.
  const defaultNewDate = useCallback(
    () => (today >= periodFrom && today <= periodTo ? today : focusedDay),
    [focusedDay, periodFrom, periodTo, today],
  );

  /* ---------------- keyboard ---------------- */

  const anyDialogOpen = drawer !== null || peekDate !== null || shortcutsOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a keystroke from a field, and never fire a shortcut
      // underneath an open dialog — each of those traps its own Escape.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (anyDialogOpen) return;

      switch (event.key) {
        case "?":
          event.preventDefault();
          setShortcutsOpen(true);
          return;
        case "/":
          event.preventDefault();
          searchRef.current?.focus();
          return;
        case "f":
          event.preventDefault();
          setFiltersOpen(true);
          return;
        case "t":
          event.preventDefault();
          goToToday();
          return;
        case "n":
          event.preventDefault();
          openNew(focusedDay);
          return;
        case "1":
        case "2":
        case "3":
        case "4": {
          event.preventDefault();
          const next = VIEWS[Number(event.key) - 1];
          if (next) switchView(next);
          return;
        }
        case "PageUp":
          event.preventDefault();
          step(-1);
          return;
        case "PageDown":
          event.preventDefault();
          step(1);
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anyDialogOpen, focusedDay, goToToday, openNew, step, switchView]);

  /* ---------------- status line ---------------- */

  const periodName =
    view === "month"
      ? fmt(anchor, { month: "long", year: "numeric" })
      : view === "day"
        ? fullDate(anchor)
        : view === "range"
          ? title
          : t("weekSubtitle", { week: isoWeek(anchor), year: anchor.getFullYear() });

  const status = isLoading
    ? t("loading")
    : isError
      ? t("loadFailed")
      : [t("itemsShown", { count: visibleItems.length }), periodName].join(" · ");

  const rangeTooLong = view === "range" && days.length >= MAX_RANGE_DAYS;
  const peekItems = peekDate ? (itemsByDay.get(dayKey(peekDate)) ?? []) : [];

  return (
    <div className="relative flex h-full flex-col gap-3 overflow-hidden px-4 py-5 sm:px-6 md:px-8">
      {/* The page has a name now. The period used to be the `h1`, so it
          rewrote itself on every arrow press and there was no stable heading
          for the calendar itself. */}
      <h1 className="sr-only">{t("pageTitle")}</h1>

      {/* ── Command bar ──
          One row, grouped by the question each control answers. It was fifteen
          controls in a single undifferentiated wrap that ran to four or five
          rows below 900px and took the grid's height with it. */}
      <div
        role="toolbar"
        aria-label={t("toolbarLabel")}
        aria-orientation="horizontal"
        className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border-light bg-bg-elevated px-2.5 py-2 calendar-rise"
      >
        <div className="flex items-center gap-1" role="group" aria-label={t("periodGroup")}>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t("previousPeriod")}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t("nextPeriod")}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            onClick={goToToday}
            className="ml-1 h-[30px] rounded-lg border border-accent-primary/30 bg-accent-primary/10 px-2.5 text-xs font-semibold text-accent-primary transition-colors hover:bg-accent-primary/20"
          >
            {t("today")}
          </button>
        </div>

        {/* In the range view the two date inputs take the title's place —
            they *are* the period, rather than a second mechanism narrowing
            inside it. */}
        {view === "range" ? (
          <div className="flex items-center gap-1.5" role="group" aria-label={t("range")}>
            <input
              type="date"
              value={rangeText.from}
              aria-label={t("from")}
              onChange={(e) => setRangeText((current) => ({ ...current, from: e.target.value }))}
              className={DATE_INPUT}
            />
            <span aria-hidden="true" className="text-xs text-fg-quaternary">→</span>
            <input
              type="date"
              value={rangeText.to}
              aria-label={t("to")}
              onChange={(e) => setRangeText((current) => ({ ...current, to: e.target.value }))}
              className={DATE_INPUT}
            />
          </div>
        ) : (
          <h2 className="px-1 font-display text-[20px] leading-none font-semibold tracking-tight text-fg-primary">
            {title}
          </h2>
        )}

        <div
          className="flex overflow-hidden rounded-lg border border-border-medium"
          role="radiogroup"
          aria-label={t("viewGroup")}
        >
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => switchView(v)}
              className={cn(
                "h-[30px] px-2.5 text-xs font-semibold transition-colors",
                view === v
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "text-fg-tertiary hover:bg-bg-secondary",
              )}
            >
              {t(VIEW_LABEL_KEYS[v])}
            </button>
          ))}
        </div>

        <span className="flex-1" />

        <div className="flex items-center gap-2" role="group" aria-label={t("lensGroup")}>
          <label className="flex h-[30px] min-w-0 items-center gap-2 rounded-lg border border-border-medium bg-bg-surface px-2.5 sm:w-[190px]">
            <Search size={13} className="shrink-0 text-fg-tertiary" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchRange")}
              aria-label={t("searchRange")}
              className="min-w-0 flex-1 border-none bg-transparent text-xs text-fg-primary outline-none placeholder:text-fg-quaternary"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("clearSearch")}
                className="shrink-0 text-fg-tertiary transition-colors hover:text-fg-primary"
              >
                <X size={12} />
              </button>
            )}
          </label>

          {/* One filter control. Kind, status and priority used to be three
              mechanisms split across the bar and a popover, with two resets
              and no single answer to "what am I hiding". */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
              className={cn(
                "flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                filtersOpen || tokens.length
                  ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                  : IDLE_CHIP,
              )}
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
              {t("filters")}
              {tokens.length > 0 && (
                <span className="tabular-nums">{tokens.length}</span>
              )}
            </button>

            {filtersOpen && (
              <div
                ref={filterRef}
                role="dialog"
                aria-label={t("filters")}
                className="calendar-pop absolute right-0 top-10 z-40 flex w-[min(300px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl"
              >
                <fieldset className="flex flex-col gap-1.5 border-b border-border-light/70 p-3.5">
                  <legend className={cn(MICRO_LABEL, "mb-1")}>{t("showLabel")}</legend>
                  {ITEM_KINDS.map((kind) => {
                    const active = kinds.has(kind);
                    const tone = KIND_CHIP_TONE[kind];
                    return (
                      <label
                        key={kind}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] text-fg-primary transition-colors hover:bg-bg-secondary/60"
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => setKinds((current) => toggleIn(current, kind))}
                          className="h-3.5 w-3.5 shrink-0 accent-[rgb(var(--accent-primary))]"
                        />
                        <span aria-hidden="true" className={cn("w-3 text-center text-[10px] font-bold", tone.text)}>
                          {KIND_GLYPH[kind]}
                        </span>
                        <span className="flex-1">{t(KIND_LABEL_KEYS[kind])}</span>
                        {/* The counts moved here from the bar — beside the
                            control that hides them, which is where the
                            number is actually actionable. */}
                        <span className="text-[11px] tabular-nums text-fg-tertiary">
                          {kindCounts[kind]}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>

                <fieldset className="flex flex-col gap-2 border-b border-border-light/70 p-3.5">
                  <legend className={cn(MICRO_LABEL, "mb-1")}>{t("taskStatus")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {TASK_STATUSES.map((s) => {
                      const active = statuses.has(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setStatuses((current) => toggleIn(current, s))}
                          className={cn(
                            SMALL_CHIP,
                            active
                              ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                              : IDLE_CHIP,
                          )}
                        >
                          {t(STATUS_LABEL_KEYS[s]!)}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="flex flex-col gap-2 p-3.5">
                  <legend className={cn(MICRO_LABEL, "mb-1")}>{t("priority")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {TASK_PRIORITIES.map((p) => {
                      const active = priorities.has(p);
                      const tone = priorityTone(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setPriorities((current) => toggleIn(current, p))}
                          className={cn(
                            SMALL_CHIP,
                            active ? cn(tone.bg, tone.border, tone.text) : IDLE_CHIP,
                          )}
                        >
                          <span className={cn("h-[7px] w-[7px] rounded-full", tone.dot)} aria-hidden="true" />
                          {t(PRIORITY_LABEL_KEYS[p]!)}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="flex items-center justify-between border-t border-border-light bg-bg-surface px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-[11px] font-semibold text-fg-secondary underline underline-offset-2 transition-colors hover:text-fg-primary"
                  >
                    {t("reset")}
                  </button>
                  <button
                    type="button"
                    onClick={closeFilters}
                    className="h-7 rounded-md border border-border-medium px-2.5 text-[11px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
                  >
                    {t("done")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setLayoutOverride(layout === "agenda" ? "grid" : "agenda")}
            aria-pressed={layout === "agenda"}
            aria-label={t("toggleAgenda")}
            title={t("toggleAgenda")}
            className={cn(
              BAR_BTN,
              "w-[30px] justify-center px-0",
              layout === "agenda" && "border-accent-primary/30 bg-accent-primary/10 text-accent-primary",
            )}
          >
            {layout === "agenda" ? <CalendarDays size={14} /> : <List size={14} />}
          </button>

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            aria-label={t("shortcutsTitle")}
            title={t("shortcutsTitle")}
            className={cn(BAR_BTN, "w-[30px] justify-center px-0")}
          >
            <HelpCircle size={14} />
          </button>

          <button
            type="button"
            onClick={() => openNew(defaultNewDate())}
            className="flex h-[30px] items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <Plus size={14} aria-hidden="true" />
            {t("newButton")}
          </button>
        </div>
      </div>

      {/* ── Status line and active filters ──
          A polite live region. Stepping a period, toggling a filter or typing
          in search used to rewrite the grid in silence. */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 px-1"
        style={{ animationDelay: "70ms" }}
      >
        <p aria-live="polite" className="text-[11px] tabular-nums text-fg-tertiary">
          {status}
        </p>
        {tokens.length > 0 && (
          <>
            <span aria-hidden="true" className="h-3 w-px bg-border-light" />
            <ul className="flex flex-wrap items-center gap-1.5" aria-label={t("activeFilters")}>
              {tokens.map((token) => (
                <li key={token.id}>
                  <button
                    type="button"
                    onClick={token.clear}
                    className="flex h-6 items-center gap-1.5 rounded-full border border-accent-primary/30 bg-accent-primary/10 pr-1.5 pl-2.5 text-[11px] font-semibold text-accent-primary transition-colors hover:bg-accent-primary/20"
                  >
                    {token.label}
                    <X size={11} aria-hidden="true" />
                    <span className="sr-only">{t("removeFilter")}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={resetFilters}
              className="text-[11px] font-semibold text-fg-secondary underline underline-offset-2 transition-colors hover:text-fg-primary"
            >
              {t("clearAll")}
            </button>
          </>
        )}
      </div>

      {rangeTooLong && (
        <p className="shrink-0 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {t("rangeCapped", { days: MAX_RANGE_DAYS })}
        </p>
      )}

      {/* ── Body ── */}
      {isError ? (
        <EmptyState
          title={t("loadFailed")}
          body={t("loadFailedBody")}
          actionLabel={t("tryAgain")}
          onAction={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="min-h-0 flex-1 animate-pulse rounded-xl border border-border-light bg-bg-elevated" />
      ) : layout === "agenda" ? (
        visibleItems.length === 0 ? (
          <ZeroState
            filtered={tokens.length > 0}
            t={t}
            onClear={resetFilters}
            onCreate={() => openNew(defaultNewDate())}
          />
        ) : (
          <CalendarAgenda
            items={visibleItems}
            today={today}
            listLabel={t("agendaLabel")}
            todayLabel={t("today")}
            untimedLabel="—"
            addLabel={t("addOnDay")}
            dayHeading={(date) => fmt(date, { weekday: "short", day: "numeric", month: "short" })}
            itemMeta={itemMeta}
            describeItem={describeItem}
            countLabel={(count) => String(count)}
            onSelectItem={openItem}
            onCreate={openNew}
          />
        )
      ) : (
        <>
          {visibleItems.length === 0 && (
            <ZeroNotice
              filtered={tokens.length > 0}
              t={t}
              onClear={resetFilters}
              onCreate={() => openNew(defaultNewDate())}
            />
          )}
          {/* The 760px floor is a readability floor, not a layout
              requirement — both grids are fluid. It is worth scrolling
              sideways for on the time views, where a column narrower than
              ~100px cannot hold an event's title, but the phone gets the
              agenda instead of a grid it has to pan. */}
          <div className="kairos-scroll-area flex min-h-0 flex-1 overflow-x-auto">
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                view === "month" ? "min-w-0 sm:min-w-[760px]" : "min-w-0 sm:min-w-[760px]",
              )}
            >
              {view === "month" ? (
                <CalendarMonthGrid
                  days={days}
                  month={anchor.getMonth()}
                  today={today}
                  itemsByDay={itemsByDay}
                  weekdayLabels={weekdayLabels}
                  weekdayLongLabels={weekdayLongLabels}
                  gridLabel={t("gridLabel", { period: periodName })}
                  moreLabel={(count) => t("moreCount", { count })}
                  addLabel={t("addOnDay")}
                  dayLabel={dayLabel}
                  describeItem={describeItem}
                  focusedIndex={focusedIndex}
                  onFocusedIndexChange={setFocusedIndex}
                  onOpenDay={setPeekDate}
                  onSelectItem={openItem}
                  onCreate={openNew}
                />
              ) : (
                <CalendarTimeGrid
                  days={days}
                  today={today}
                  now={now}
                  itemsByDay={itemsByDay}
                  hours={hours}
                  weekdayLabel={weekdayLabel}
                  gridLabel={t("gridLabel", { period: periodName })}
                  allDayLabel={t("allDay")}
                  addLabel={t("addOnDay")}
                  dayLabel={dayLabel}
                  slotLabel={(date, hour) =>
                    t("addAtHour", { time: `${String(hour).padStart(2, "0")}:00`, day: fullDate(date) })
                  }
                  nowLabel={(time) => t("nowLine", { time })}
                  countLabel={(count) => (count > 0 ? String(count) : "")}
                  describeItem={describeItem}
                  focusedIndex={focusedIndex}
                  onFocusedIndexChange={setFocusedIndex}
                  onOpenDay={setPeekDate}
                  onSelectItem={openItem}
                  onCreate={openNew}
                />
              )}
            </div>
          </div>
        </>
      )}

      {peekDate && (
        <CalendarDayPeek
          items={peekItems}
          title={fullDate(peekDate)}
          countLabel={t("itemsCount", { count: peekItems.length })}
          emptyLabel={t("noItemsDay")}
          addLabel={t("addHere")}
          openDayLabel={t("openDayView")}
          closeLabel={t("close")}
          describeItem={describeItem}
          onClose={() => setPeekDate(null)}
          onSelectItem={openItem}
          onCreate={() => openNew(peekDate)}
          onOpenDayView={() => {
            setAnchor(startOfDayLocal(peekDate));
            setView("day");
            setPeekDate(null);
          }}
        />
      )}

      {shortcutsOpen && (
        <ShortcutSheet panelRef={shortcutsRef} onClose={closeShortcuts} t={t} />
      )}

      {drawer && (
        <CalendarDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          onCreated={() => {
            refreshCalendar();
            setDrawer(null);
          }}
          onChanged={refreshCalendar}
          onDeleted={() => {
            refreshCalendar();
            setDrawer(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty and zero states                                             */
/*                                                                    */
/*  "Nothing scheduled" and "your filters hid everything" used to     */
/*  render identically — an empty grid — which is the version people  */
/*  read as "the calendar is broken".                                 */
/* ------------------------------------------------------------------ */

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border-light bg-bg-elevated p-8 text-center">
      <p className="text-[15px] font-semibold text-fg-primary">{title}</p>
      <p className="max-w-[40ch] text-[13px] text-fg-tertiary">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-1 h-9 rounded-lg bg-accent-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
      >
        {actionLabel}
      </button>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations<"calendar.filters">>;

function ZeroState({
  filtered,
  t,
  onClear,
  onCreate,
}: {
  filtered: boolean;
  t: Translate;
  onClear: () => void;
  onCreate: () => void;
}) {
  return filtered ? (
    <EmptyState
      title={t("noMatchTitle")}
      body={t("noMatchBody")}
      actionLabel={t("clearAll")}
      onAction={onClear}
    />
  ) : (
    <EmptyState
      title={t("nothingTitle")}
      body={t("nothingBody")}
      actionLabel={t("addSomething")}
      onAction={onCreate}
    />
  );
}

/** The grid keeps its shape when empty — a calendar with nothing on it is
 *  still a calendar — so the explanation is a strip above it rather than a
 *  panel replacing it. */
function ZeroNotice({
  filtered,
  t,
  onClear,
  onCreate,
}: {
  filtered: boolean;
  t: Translate;
  onClear: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-border-medium bg-bg-surface px-3 py-2">
      <p className="text-[12px] text-fg-secondary">
        {filtered ? t("noMatchBody") : t("nothingBody")}
      </p>
      <button
        type="button"
        onClick={filtered ? onClear : onCreate}
        className="h-7 rounded-md border border-accent-primary/30 bg-accent-primary/10 px-2.5 text-[11px] font-semibold text-accent-primary transition-colors hover:bg-accent-primary/20"
      >
        {filtered ? t("clearAll") : t("addSomething")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shortcut sheet                                                    */
/* ------------------------------------------------------------------ */

const SHORTCUTS: { keys: string[]; key: string }[] = [
  { keys: ["←", "→", "↑", "↓"], key: "shortcutArrows" },
  { keys: ["Enter"], key: "shortcutEnter" },
  { keys: ["Esc"], key: "shortcutEscape" },
  { keys: ["n"], key: "shortcutNew" },
  { keys: ["t"], key: "shortcutToday" },
  { keys: ["/"], key: "shortcutSearch" },
  { keys: ["f"], key: "shortcutFilters" },
  { keys: ["1", "2", "3", "4"], key: "shortcutViews" },
  { keys: ["Home", "End"], key: "shortcutHomeEnd" },
  { keys: ["PgUp", "PgDn"], key: "shortcutPaging" },
  { keys: ["?"], key: "shortcutHelp" },
];

function ShortcutSheet({
  panelRef,
  onClose,
  t,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  t: Translate;
}) {
  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] calendar-scrim" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcutsTitle")}
        className="calendar-pop relative flex max-h-[80dvh] w-full max-w-[26rem] flex-col overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-light px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-fg-primary">
            {t("shortcutsTitle")}
          </h2>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            <X size={13} />
          </button>
        </div>
        <dl className="kairos-scroll-area flex min-h-0 flex-1 flex-col overflow-y-auto">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-start justify-between gap-4 border-b border-border-light/60 px-5 py-2.5 last:border-b-0"
            >
              <dt className="flex shrink-0 flex-wrap gap-1">
                {shortcut.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-[1.6em] rounded border border-border-medium border-b-2 bg-bg-secondary px-1.5 py-0.5 text-center text-[11px] font-semibold text-fg-primary"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-right text-[12px] leading-snug text-fg-secondary">
                {t(shortcut.key)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="shrink-0 border-t border-border-light bg-bg-surface px-5 py-3 text-[11px] leading-snug text-fg-tertiary">
          {t("shortcutsFooter")}
        </p>
      </div>
    </div>
  );
}
